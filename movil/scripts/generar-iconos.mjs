// Genera los PNG de partida a partir de los SVG de public/icons/:
//  - movil/assets/*.png  -> fuente para `npm run iconos` (@capacitor/assets),
//    que crea los iconos y splash nativos de Android e iOS.
//  - public/icons/*.png  -> iconos de la PWA (manifest y apple-touch-icon).
// Uso (desde movil/): node scripts/generar-iconos.mjs
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dirIconos = join(raiz, "public", "icons");
const dirAssets = join(raiz, "movil", "assets");

const AZUL = "#0B4F8A";
const FUENTE = "'Nunito Sans','Inter','Segoe UI',Arial,sans-serif";
const degradado = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="${AZUL}"/></linearGradient></defs>`;
const texto = (y, tam, esp) =>
  `<text x="256" y="${y}" text-anchor="middle" font-family="${FUENTE}" font-size="${tam}" font-weight="900" fill="#ffffff" letter-spacing="${esp}">HM</text>`;

// Cuadrado completo sin transparencia (iOS redondea por su cuenta y no
// admite alfa). Mismo dibujo que icon.svg pero sin esquinas redondeadas.
const svgCuadradoHM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${degradado}<rect width="512" height="512" fill="url(#bg)"/>${texto(346, 260, -14)}</svg>`;
// Icono adaptativo de Android: primer plano transparente con las letras
// dentro del circulo de recorte (capacitor-assets ya aplica un inset del 16,7 %)
// y fondo con el degradado.
const svgPrimerPlanoHM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${texto(330, 210, -10)}</svg>`;
const svgFondo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${degradado}<rect width="512" height="512" fill="url(#bg)"/></svg>`;

// sinAlfa: aplana sobre azul y quita el canal alfa (App Store lo rechaza).
const png = (svg, tam, destino, sinAlfa = false) => {
  let img = sharp(Buffer.from(svg), { density: 72 * (tam / 512) * 2 }).resize(tam, tam);
  if (sinAlfa) img = img.flatten({ background: AZUL }).removeAlpha();
  return img
    .png()
    .toFile(destino)
    .then(() => console.log("ok", destino));
};

async function splash(destino) {
  // Lienzo 2732x2732 azul con el icono redondeado (icon.svg) en el centro.
  const icono = await sharp(await readFile(join(dirIconos, "icon.svg")), { density: 288 })
    .resize(640, 640)
    .png()
    .toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: AZUL } })
    .composite([{ input: icono, gravity: "center" }])
    .removeAlpha()
    .png()
    .toFile(destino);
  console.log("ok", destino);
}

await mkdir(dirAssets, { recursive: true });
// Icono «gota y ondas» (2026-11-10). Los dibujos HM de arriba quedan solo de
// referencia (svgCuadradoHM, svgPrimerPlanoHM); los SVG viejos estan en
// public/icons/*-hm-old.svg.
const svgCuadrado = await readFile(join(dirIconos, "icon-app.svg"), "utf8");
const svgPrimerPlano = await readFile(join(dirIconos, "icon-app-primer-plano.svg"), "utf8");
const svgIcono = await readFile(join(dirIconos, "icon.svg"), "utf8");
const svgMaskable = await readFile(join(dirIconos, "maskable.svg"), "utf8");

await Promise.all([
  // Fuente para @capacitor/assets
  png(svgCuadrado, 1024, join(dirAssets, "icon-only.png"), true),
  png(svgPrimerPlano, 1024, join(dirAssets, "icon-foreground.png")),
  png(svgFondo, 1024, join(dirAssets, "icon-background.png")),
  splash(join(dirAssets, "splash.png")),
  splash(join(dirAssets, "splash-dark.png")),
  // PWA
  png(svgIcono, 192, join(dirIconos, "icon-192.png")),
  png(svgIcono, 512, join(dirIconos, "icon-512.png")),
  png(svgMaskable, 512, join(dirIconos, "maskable-512.png")),
  png(svgCuadrado, 180, join(dirIconos, "apple-touch-icon.png"), true),
]);
