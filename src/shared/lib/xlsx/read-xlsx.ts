import "server-only";
import zlib from "node:zlib";

/**
 * Lector de .xlsx SIN dependencias. Un .xlsx es un ZIP con XML dentro; aquí
 * parseamos el directorio central del ZIP, inflamos con el zlib de Node y
 * extraemos las celdas con regex. Suficiente para importar listados de
 * clientes (texto + números + fechas). No cubre fórmulas complejas ni estilos.
 *
 * Devuelve las filas de la PRIMERA hoja como matriz de strings.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&"); // amp el último para no romper otras entidades
}

/** Parsea el directorio central del ZIP y devuelve nombre→bytes descomprimidos. */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // End Of Central Directory: buscamos su firma (0x06054b50) desde el final.
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archivo .xlsx inválido (sin EOCD)");
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const out = new Map<string, Buffer>();
  for (let n = 0; n < cdCount; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + fnLen);

    // El header local tiene sus PROPIOS tamaños de filename/extra (pueden
    // diferir del central): los datos empiezan tras ellos.
    if (buf.readUInt32LE(localOff) === 0x04034b50) {
      const lfnLen = buf.readUInt16LE(localOff + 26);
      const lextraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lfnLen + lextraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      try {
        if (method === 0) out.set(name, comp); // stored
        else if (method === 8) out.set(name, zlib.inflateRawSync(comp)); // deflate
      } catch {
        /* entrada ilegible: la saltamos */
      }
    }
    off = off + 46 + fnLen + extraLen + commentLen;
  }
  return out;
}

function columnIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1] ?? "") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsxRows(buf: Buffer): string[][] {
  const entries = readZipEntries(buf);

  // Cadenas compartidas
  const shared: string[] = [];
  const ssBuf = entries.get("xl/sharedStrings.xml");
  if (ssBuf) {
    const xml = ssBuf.toString("utf8");
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = siRe.exec(xml))) {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tm: RegExpExecArray | null;
      let s = "";
      while ((tm = tRe.exec(m[1] ?? ""))) s += tm[1] ?? "";
      shared.push(decodeEntities(s));
    }
  }

  // Primera hoja
  let sheetName = "xl/worksheets/sheet1.xml";
  if (!entries.has(sheetName)) {
    sheetName =
      [...entries.keys()].find((k) => /^xl\/worksheets\/.*\.xml$/.test(k)) ??
      sheetName;
  }
  const shBuf = entries.get(sheetName);
  if (!shBuf) throw new Error("El .xlsx no tiene hoja de datos");
  const xml = shBuf.toString("utf8");

  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const inner = rm[1] ?? "";
    const cells: Record<number, string> = {};
    let maxc = -1;
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(inner))) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const col = columnIndex(ref);
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      let val = "";
      if (t === "s") {
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const idx = vm ? parseInt(vm[1] ?? "", 10) : -1;
        val = idx >= 0 && idx < shared.length ? shared[idx] ?? "" : "";
      } else if (t === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let im: RegExpExecArray | null;
        let s = "";
        while ((im = tRe.exec(body))) s += im[1] ?? "";
        val = decodeEntities(s);
      } else {
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        val = vm ? decodeEntities(vm[1] ?? "") : "";
      }
      cells[col] = val;
      if (col > maxc) maxc = col;
    }
    const arr: string[] = [];
    for (let i = 0; i <= maxc; i++) arr.push(cells[i] ?? "");
    rows.push(arr);
  }
  return rows;
}
