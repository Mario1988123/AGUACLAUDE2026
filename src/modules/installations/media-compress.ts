// Utilidades de compresión en el CLIENTE (browser). Importar solo desde
// componentes "use client". Sin dependencias de servidor.

/** Redimensiona/comprime una imagen a JPEG (máx 1600px lado largo, q~0.8). */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 1600;
    let { width, height } = bitmap;
    if (width > MAX || height > MAX) {
      const scale = MAX / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.8),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file; // HEIC u otros formatos no decodificables → original
  }
}

/** Duración del vídeo en segundos (0 si no se puede leer). */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        const d = v.duration || 0;
        URL.revokeObjectURL(v.src);
        resolve(Number.isFinite(d) ? d : 0);
      };
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(file);
    } catch {
      resolve(0);
    }
  });
}

/**
 * Comprime un vídeo a 720p / ~1Mbps con ffmpeg.wasm (lazy-load). BEST-EFFORT:
 * si ffmpeg no carga (Safari viejo, sin red al CDN) o falla, devuelve el
 * original. El caller aplica el cap de tamaño final.
 */
export async function compressVideo(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  try {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    if (onProgress) ffmpeg.on("progress", (p) => onProgress(p.progress));
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    await ffmpeg.writeFile("in.dat", await fetchFile(file));
    await ffmpeg.exec([
      "-i", "in.dat",
      "-t", "30",                 // recorta a 30s por seguridad
      "-vf", "scale='min(1280,iw)':-2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "30",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
    const data = await ffmpeg.readFile("out.mp4");
    // data es Uint8Array
    const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
    return new File([blob], "video.mp4", { type: "video/mp4" });
  } catch {
    return file; // fallback: original (el caller valida tamaño)
  }
}
