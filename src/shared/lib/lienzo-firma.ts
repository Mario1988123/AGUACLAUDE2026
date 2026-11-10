// Ajusta el tamaño interno de un <canvas> de firma a su tamaño en pantalla
// (por densidad de píxeles) y lo mantiene ajustado si cambia: giro del móvil,
// teclado, cambio de ancho del modal... Sin esto el lienzo se medía una sola
// vez al abrirse y, tras girar el iPhone, el trazo salía desplazado del dedo.
// Al redimensionar conserva lo ya dibujado (escalado al tamaño nuevo).

export type EstiloTrazo = {
  lineWidth: number;
  strokeStyle: string;
};

export function ajustarLienzoFirma(canvas: HTMLCanvasElement, estilo: EstiloTrazo): () => void {
  let anchoCss = 0;
  let altoCss = 0;

  const aplicar = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (Math.round(rect.width) === Math.round(anchoCss) && Math.round(rect.height) === Math.round(altoCss)) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;

    // Copia de lo dibujado antes de que cambiar width/height lo borre.
    let copia: HTMLCanvasElement | null = null;
    if (anchoCss > 0 && canvas.width > 0 && canvas.height > 0) {
      copia = document.createElement("canvas");
      copia.width = canvas.width;
      copia.height = canvas.height;
      copia.getContext("2d")?.drawImage(canvas, 0, 0);
    }

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    anchoCss = rect.width;
    altoCss = rect.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (copia) ctx.drawImage(copia, 0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = estilo.lineWidth;
    ctx.strokeStyle = estilo.strokeStyle;
  };

  aplicar();
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", aplicar);
    return () => window.removeEventListener("resize", aplicar);
  }
  const observador = new ResizeObserver(() => aplicar());
  observador.observe(canvas);
  return () => observador.disconnect();
}

/** Borra el lienzo entero sea cual sea la transformación activa. */
export function borrarLienzo(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
