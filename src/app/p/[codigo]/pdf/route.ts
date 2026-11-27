import { NextResponse } from "next/server";
import { admin } from "@/modules/captacion/servidor";
import { estadoPropuesta, esAgenteAutomatico, nombreFicheroPdf } from "@/modules/captacion/propuesta-logica";
import { guardarPdf, leerPdf, leerPropuestaPorCodigo, visitanteDe } from "@/modules/captacion/propuesta-servidor";
import { generarPdfPropuesta } from "@/modules/captacion/pdf-propuesta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CABECERAS_PRIVADAS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

/**
 * /p/[codigo]/pdf — el PDF de la propuesta desde el bucket privado (diseño
 * §5.4). Mismas comprobaciones que la página: si no existe, 404 sin pistas;
 * caducada o retirada, no se entrega y se vuelve a la página. Si el PDF no
 * llegó a generarse (fallo al «Sí»), se genera ahora y se guarda.
 * Marca descargo_pdf en la visita de hoy de este visitante, si la hay (no
 * crea visitas: eso solo lo hace el latido de la página).
 */
export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const prop = await leerPropuestaPorCodigo(codigo);
  if (!prop) return new NextResponse("No encontrada", { status: 404, headers: CABECERAS_PRIVADAS });
  if (estadoPropuesta(prop) !== "valida") {
    return NextResponse.redirect(new URL(`/p/${prop.codigo}`, req.url), { status: 303, headers: CABECERAS_PRIVADAS });
  }

  let bytes = await leerPdf(prop);
  if (!bytes) {
    try {
      const pdf = await generarPdfPropuesta(prop.company_id, prop);
      await guardarPdf(prop, pdf.bytes, pdf.paginas);
      bytes = pdf.bytes;
    } catch (e) {
      console.error("[captacion/pdf] no se pudo generar", e instanceof Error ? e.message : e);
      return new NextResponse("No disponible", { status: 503, headers: CABECERAS_PRIVADAS });
    }
  }

  const v = visitanteDe(req.headers);
  if (!esAgenteAutomatico(v.agente)) {
    const { error } = await admin()
      .from("captacion_visitas")
      .update({ descargo_pdf: true })
      .eq("propuesta_id", prop.id)
      .eq("visitante_hash", v.hash)
      .eq("descargo_pdf", false);
    if (error) console.error("[captacion/pdf] descarga:", error.message);
  }

  const nombre = nombreFicheroPdf(prop.nombre_negocio);
  const ascii = nombre.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      ...CABECERAS_PRIVADAS,
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    },
  });
}
