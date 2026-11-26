/**
 * Ficha técnica nueva (Tarifa, Escaparate, Placa): cargar → paleta →
 * imágenes → pintar. Recibe el cliente por parámetro: la app le pasa el admin
 * client después de comprobar que el producto es de la empresa
 * (datasheet-pick.ts y las rutas de PDF), y el script de vista previa uno de
 * solo lectura.
 */

import { cargarFicha, type AjustesFicha } from "./cargar-ficha";
import { descargar, prepararImagen, repintarIcono } from "./imagenes";
import { esPlantillaNueva, type FichaModelo, type PlantillaNueva } from "./modelo";
import { derivarPaleta, normalizarHex, proponerPaletas, type PaletaFicha } from "./paleta";
import { pintarFicha } from "./pintar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface OpcionesGenerar {
  /** Fuerza la plantilla (vista previa, ?t=). Si no, la de la empresa o «Tarifa». */
  plantilla?: PlantillaNueva;
  /** Colores sin guardar (vista previa de configuración, ?p=&a=). */
  primario?: string | null;
  acento?: string | null;
  /** Solo el script de vista previa: cambia datos en memoria antes de pintar. */
  simular?: Parameters<typeof cargarFicha>[2];
}

/**
 * Colores de la ficha. Orden: los de la petición (vista previa) → la paleta
 * guardada (datasheet_palette) → el color de la empresa (companies.primary_color,
 * el del alta) → el «Color base» de las plantillas anteriores.
 */
export function coloresDeFicha(ajustes: AjustesFicha, o: { primario?: string | null; acento?: string | null } = {}) {
  const primario =
    normalizarHex(o.primario) ??
    ajustes.paleta?.primario ??
    ajustes.colorEmpresa ??
    ajustes.colorBaseAnterior ??
    "#1f3a5f";
  const acento =
    normalizarHex(o.acento) ??
    (normalizarHex(o.primario) ? null : ajustes.paleta?.acento) ??
    proponerPaletas(primario)[0]!.acento;
  return { primario, acento };
}

export async function generarFichaConCliente(
  sb: Cliente,
  productId: string,
  opciones: OpcionesGenerar = {},
): Promise<{ bytes: Uint8Array; modelo: FichaModelo; paleta: PaletaFicha; plantilla: PlantillaNueva }> {
  const { modelo, ajustes } = await cargarFicha(sb, productId, opciones.simular);
  const plantilla: PlantillaNueva =
    opciones.plantilla ?? (esPlantillaNueva(ajustes.plantilla) ? ajustes.plantilla : "tarifa");
  const { primario, acento } = coloresDeFicha(ajustes, opciones);
  const paleta = derivarPaleta(primario, acento);

  const [logoB, fotoB, medidasB, ...iconosB] = await Promise.all([
    descargar(modelo.empresa.logoUrl),
    descargar(modelo.fotoUrl),
    modelo.medidasUrl ? descargar(modelo.medidasUrl) : Promise.resolve(null),
    ...modelo.ventajas.map((v) => (v.iconoUrl ? descargar(v.iconoUrl) : Promise.resolve(null))),
  ]);
  const [logo, foto, medidas, ...iconos] = await Promise.all([
    prepararImagen(logoB, { recortar: true, maxPx: 900 }),
    prepararImagen(fotoB, { maxPx: 1400 }),
    prepararImagen(medidasB, { maxPx: 1400 }),
    // [decide] Iconos de ventaja en el acento como gráfico (≥ 3:1 sobre papel).
    ...iconosB.map((b) => repintarIcono(b, paleta.acentoMarca)),
  ]);
  // Sin plano de medidas no hay letras si tampoco hay tres cotas (lo decide el modelo).
  const bytes = await pintarFicha({
    modelo,
    plantilla,
    paleta,
    imagenes: { logo, foto, medidas, iconos },
  });
  return { bytes, modelo, paleta, plantilla };
}
