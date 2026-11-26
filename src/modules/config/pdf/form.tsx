"use client";

/**
 * Configuración → Fichas técnicas (docs/DISENO_FICHAS_Y_PRODUCTOS.md §C.3).
 * Tres pasos en una página: plantilla, colores de la marca (tres propuestas
 * calculadas) y datos del pie. Maqueta en vivo y «Ver PDF real» con los
 * valores sin guardar. Se guarda todo junto; salir sin guardar no cambia nada.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Eye, TriangleAlert } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { cn } from "@/shared/lib/utils";
import {
  NOMBRE_PLANTILLA,
  PLANTILLAS_NUEVAS,
  esPlantillaNueva,
  type FichaModelo,
  type PlantillaNueva,
} from "@/modules/products/ficha/modelo";
import {
  derivarPaleta,
  distanciaOklab,
  normalizarHex,
  proponerPaletas,
  type ClavePropuesta,
} from "@/modules/products/ficha/paleta";
import { updatePdfSettingsAction, type DatasheetTemplate, type PdfSettings } from "./actions";
import { MuestraPaleta, VistaPreviaFicha } from "./vista-previa-ficha";

export interface MuestraOpcion {
  id: string;
  nombre: string;
}

const PARA_QUIEN: Record<PlantillaNueva, string> = {
  tarifa: "Papel blanco y línea fina. Para instaladores, distribuidores y presupuestos.",
  escaparate: "Franja con tu color arriba. Para enseñar al cliente en casa.",
  placa: "Compacta y en rejilla. Para imprimir en blanco y negro y productos con muchos datos.",
};

function FichaColor({
  color,
  activo,
  onClick,
  etiqueta,
}: {
  color: string;
  activo: boolean;
  onClick: () => void;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      aria-label={`${etiqueta} ${color}`}
      title={color}
      className={cn(
        "h-12 w-12 shrink-0 rounded-xl ring-1 ring-border transition-transform active:scale-[.97]",
        activo && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
      )}
      style={{ background: color }}
    />
  );
}

function CampoHex({ valor, onChange, etiqueta }: { valor: string; onChange: (v: string) => void; etiqueta: string }) {
  const [texto, setTexto] = useState(valor);
  const [anterior, setAnterior] = useState(valor);
  if (valor !== anterior) {
    setAnterior(valor);
    setTexto(valor);
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1"
        aria-label={etiqueta}
      />
      <input
        type="text"
        value={texto}
        inputMode="text"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setTexto(e.target.value);
          const h = normalizarHex(e.target.value);
          if (h) onChange(h);
        }}
        className="h-11 w-32 rounded-xl border border-input bg-background px-3 font-mono text-base uppercase md:text-sm"
        maxLength={7}
        aria-label={`${etiqueta} (hexadecimal)`}
      />
    </div>
  );
}

function Plegable({ titulo, children, abierto }: { titulo: string; children: React.ReactNode; abierto?: boolean }) {
  return (
    <details open={abierto} className="group rounded-xl border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold">
        {titulo}
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}

export function PdfSettingsForm({
  initial,
  modelo,
  muestras,
  muestraId,
  coloresLogo,
}: {
  initial: PdfSettings;
  modelo: FichaModelo | null;
  muestras: MuestraOpcion[];
  muestraId: string | null;
  coloresLogo: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [verFicha, setVerFicha] = useState(false);

  // --- Estado -----------------------------------------------------------------
  const baseInicial =
    initial.paleta?.base ?? initial.colorEmpresa ?? coloresLogo[0] ?? initial.pdf_brand_color.toLowerCase();
  const [plantilla, setPlantilla] = useState<DatasheetTemplate>(initial.datasheet_template);
  const [base, setBase] = useState(baseInicial);
  const [propuesta, setPropuesta] = useState<ClavePropuesta | "manual">(initial.paleta?.propuesta ?? "marca_sola");
  const [manual, setManual] = useState({
    primario: initial.paleta?.primario ?? baseInicial,
    acento: initial.paleta?.acento ?? proponerPaletas(baseInicial)[0]!.acento,
  });
  const [opc, setOpc] = useState({
    telefono: initial.opciones.telefono ?? "",
    correo: initial.opciones.correo ?? "",
    web: initial.opciones.web ?? "",
    mostrar_recambios: initial.opciones.mostrarRecambios,
    mostrar_ventajas: initial.opciones.mostrarVentajas,
  });
  const [brand, setBrand] = useState(initial.pdf_brand_color);
  const [accent, setAccent] = useState(initial.pdf_accent_color);

  const segundoLogo = coloresLogo.find((c) => c !== base) ?? null;
  const propuestas = useMemo(() => proponerPaletas(base, segundoLogo), [base, segundoLogo]);
  const elegida = propuesta === "manual" ? manual : (propuestas.find((p) => p.clave === propuesta) ?? propuestas[0]!);
  const paleta = useMemo(() => derivarPaleta(elegida.primario, elegida.acento), [elegida.primario, elegida.acento]);
  const plantillaNueva: PlantillaNueva = esPlantillaNueva(plantilla) ? plantilla : "tarifa";
  const enAntigua = !esPlantillaNueva(initial.datasheet_template);

  const yaTenias = Array.from(
    new Set([initial.colorEmpresa, normalizarHex(initial.pdf_brand_color)].filter((c): c is string => !!c)),
  ).filter((c) => !coloresLogo.includes(c));

  const estadoGuardable = JSON.stringify({ plantilla, base, propuesta, elegida, opc, brand, accent });
  const [guardado, setGuardado] = useState(estadoGuardable);
  const hayCambios = estadoGuardable !== guardado;
  const bloqueado = !initial.hayMigracion && esPlantillaNueva(plantilla);

  const urlPdf = (t: string, conColores = true) => {
    if (!muestraId) return null;
    const q = new URLSearchParams({ t });
    if (conColores && esPlantillaNueva(t)) {
      q.set("p", elegida.primario.slice(1));
      q.set("a", elegida.acento.slice(1));
    }
    return `/api/pdf/product-datasheet/${muestraId}?${q.toString()}`;
  };

  function guardar() {
    startTransition(async () => {
      const nueva = esPlantillaNueva(plantilla);
      const r = await updatePdfSettingsAction({
        datasheet_template: plantilla,
        ...(nueva
          ? {
              paleta: { propuesta, base, primario: elegida.primario, acento: elegida.acento },
              opciones: {
                telefono: opc.telefono || null,
                correo: opc.correo || null,
                web: opc.web || null,
                mostrar_recambios: opc.mostrar_recambios,
                mostrar_ventajas: opc.mostrar_ventajas,
              },
            }
          : { pdf_brand_color: brand, pdf_accent_color: accent }),
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      setGuardado(estadoGuardable);
      notify.success("Guardado", "Las fichas técnicas saldrán así a partir de ahora.");
      router.refresh();
    });
  }

  const aviso: string[] = [];
  if (paleta.soloCampo)
    aviso.push("Tu color es claro: en fondos sale tal cual; en títulos y líneas usamos una tinta oscura para que se lea.");
  if (distanciaOklab(elegida.primario, elegida.acento) < 0.1)
    aviso.push("Tus dos colores se parecen mucho: el acento no destacará.");

  const botonPdf = (clase?: string) => {
    const url = urlPdf(esPlantillaNueva(plantilla) ? plantilla : plantilla, true);
    if (!url) return null;
    return (
      <Button asChild variant="outline" className={clase}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Ver PDF real
        </a>
      </Button>
    );
  };

  const vista = modelo ? (
    esPlantillaNueva(plantilla) ? (
      <VistaPreviaFicha modelo={modelo} plantilla={plantillaNueva} paleta={paleta} />
    ) : (
      <div className="flex aspect-[210/297] w-full items-center justify-center rounded-sm bg-muted p-6 text-center text-sm text-muted-foreground ring-1 ring-border">
        La plantilla {NOMBRE_PLANTILLA[plantilla]} no tiene maqueta: pulsa «Ver PDF real».
      </div>
    )
  ) : null;

  const selectorMuestra =
    muestras.length > 1 ? (
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Producto de muestra</span>
        <select
          value={muestraId ?? ""}
          onChange={(e) => router.replace(`/configuracion/pdf?muestra=${e.target.value}`, { scroll: false })}
          className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
        >
          {muestras.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div className="lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-8">
        {!initial.hayMigracion && (
          <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Puedes probar las plantillas nuevas y ver el PDF, pero todavía no se pueden guardar: falta una
            actualización de la base de datos.
          </p>
        )}

        {/* 1 · Plantilla */}
        <section aria-labelledby="paso-plantilla" className="space-y-3">
          <h2 id="paso-plantilla" className="text-base font-bold">
            Plantilla
          </h2>
          {enAntigua && muestraId && (
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Hay plantillas nuevas. Mira cómo quedaría tu ficha.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={urlPdf(initial.datasheet_template, false)!} target="_blank" rel="noopener noreferrer">
                    Tu ficha actual
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={urlPdf("tarifa")!} target="_blank" rel="noopener noreferrer">
                    La misma en «Tarifa»
                  </a>
                </Button>
              </div>
            </div>
          )}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {PLANTILLAS_NUEVAS.map((t) => {
              const activa = plantilla === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPlantilla(t)}
                  aria-pressed={activa}
                  className={cn(
                    "w-[132px] shrink-0 snap-start rounded-xl border bg-card p-2 text-left transition-transform active:scale-[.97] sm:w-auto",
                    activa ? "border-2 border-foreground" : "border-border",
                  )}
                >
                  {modelo ? (
                    <VistaPreviaFicha modelo={modelo} plantilla={t} paleta={paleta} topeFilas={18} />
                  ) : (
                    <div className="aspect-[210/297] w-full rounded-sm bg-muted" />
                  )}
                  <span className="mt-2 block text-sm font-bold">
                    {NOMBRE_PLANTILLA[t]}
                    {initial.datasheet_template === t && (
                      <span className="ml-1 font-normal text-muted-foreground">· la tuya</span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground">{PARA_QUIEN[t]}</span>
                </button>
              );
            })}
          </div>
          <Plegable titulo="Plantillas anteriores" abierto={enAntigua}>
            <div className="grid grid-cols-2 gap-2">
              {(["standard", "iagua"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPlantilla(t)}
                  aria-pressed={plantilla === t}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition-transform active:scale-[.97]",
                    plantilla === t ? "border-2 border-foreground font-semibold" : "border-border",
                  )}
                >
                  {NOMBRE_PLANTILLA[t]}
                  {initial.datasheet_template === t && (
                    <span className="block text-xs font-normal text-muted-foreground">La que usas ahora</span>
                  )}
                </button>
              ))}
            </div>
            {!esPlantillaNueva(plantilla) && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="text-sm font-semibold">Color base</span>
                  <CampoHex valor={brand} onChange={setBrand} etiqueta="Color base" />
                  <p className="text-xs text-muted-foreground">Cabecera y títulos de estas dos plantillas.</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-semibold">Color de acento</span>
                  <CampoHex valor={accent} onChange={setAccent} etiqueta="Color de acento" />
                  <p className="text-xs text-muted-foreground">
                    Detalles de la IAGUA. Se puede afinar por producto desde su ficha.
                  </p>
                </div>
              </div>
            )}
          </Plegable>
        </section>

        {/* 2 · Colores */}
        {esPlantillaNueva(plantilla) && (
          <section aria-labelledby="paso-colores" className="space-y-3">
            <h2 id="paso-colores" className="text-base font-bold">
              Colores de tu marca
            </h2>
            {coloresLogo.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-sm text-muted-foreground">Sacados de tu logo</span>
                <div className="flex flex-wrap gap-2">
                  {coloresLogo.map((c) => (
                    <FichaColor key={c} color={c} etiqueta="Color del logo" activo={base === c} onClick={() => setBase(c)} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hemos podido sacar colores de tu logo.{" "}
                <a href="/configuracion/fiscal" className="font-semibold text-foreground underline underline-offset-4">
                  Sube tu logo
                </a>
              </p>
            )}
            {yaTenias.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-sm text-muted-foreground">Los que ya tenías</span>
                <div className="flex flex-wrap gap-2">
                  {yaTenias.map((c) => (
                    <FichaColor key={c} color={c} etiqueta="Color guardado" activo={base === c} onClick={() => setBase(c)} />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Otro color</span>
              <CampoHex valor={base} onChange={(v) => setBase(v)} etiqueta="Color de tu marca" />
            </div>

            <div className="space-y-1.5 pt-1">
              <span className="text-sm font-semibold">Elige una propuesta</span>
              <div className="grid grid-cols-3 gap-2">
                {propuestas.map((p) => {
                  const pal = derivarPaleta(p.primario, p.acento);
                  const activa = propuesta === p.clave;
                  return (
                    <button
                      key={p.clave}
                      type="button"
                      onClick={() => setPropuesta(p.clave)}
                      aria-pressed={activa}
                      title={p.descripcion}
                      className={cn(
                        "rounded-xl border p-1.5 text-left transition-transform active:scale-[.97]",
                        activa ? "border-2 border-foreground" : "border-border",
                      )}
                    >
                      <div className="h-[64px]">
                        <MuestraPaleta paleta={pal} nombre={modelo?.nombre ?? "Tu producto"} />
                      </div>
                      <span className="mt-1 block text-xs font-semibold leading-tight">{p.nombre}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {propuesta === "manual"
                  ? "Colores puestos a mano."
                  : propuestas.find((p) => p.clave === propuesta)?.descripcion}
              </p>
            </div>
            {aviso.map((a) => (
              <p key={a} className="flex gap-2 rounded-xl bg-muted p-3 text-xs">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {a}
              </p>
            ))}
            <Plegable titulo="Ajustar a mano" abierto={propuesta === "manual"}>
              <div className="space-y-1">
                <span className="text-sm font-semibold">Principal</span>
                <CampoHex
                  valor={elegida.primario}
                  onChange={(v) => {
                    setManual({ primario: v, acento: elegida.acento });
                    setPropuesta("manual");
                  }}
                  etiqueta="Color principal"
                />
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold">Acento</span>
                <CampoHex
                  valor={elegida.acento}
                  onChange={(v) => {
                    setManual({ primario: elegida.primario, acento: v });
                    setPropuesta("manual");
                  }}
                  etiqueta="Color de acento"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Los textos se oscurecen solos lo justo para que se lean bien.
              </p>
            </Plegable>
          </section>
        )}

        {/* 3 · Pie y qué se enseña */}
        {esPlantillaNueva(plantilla) && (
          <section aria-labelledby="paso-pie" className="space-y-3">
            <h2 id="paso-pie" className="text-base font-bold">
              Datos del pie y qué se enseña
            </h2>
            {(
              [
                ["telefono", "Teléfono", "tel", modelo?.empresa.telefono],
                ["correo", "Correo", "email", modelo?.empresa.correo],
                ["web", "Web", "url", "www.tuempresa.es"],
              ] as const
            ).map(([k, etiqueta, tipo, ph]) => (
              <label key={k} className="block text-sm">
                <span className="mb-1 block font-semibold">{etiqueta}</span>
                <input
                  type={tipo}
                  value={opc[k]}
                  placeholder={ph ?? ""}
                  onChange={(e) => setOpc({ ...opc, [k]: e.target.value })}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
                  maxLength={120}
                />
              </label>
            ))}
            <p className="text-xs text-muted-foreground">Vacío = el de tus datos fiscales.</p>
            {(
              [
                ["mostrar_recambios", "Consumibles y recambios", "Los filtros y piezas que lleva el equipo."],
                ["mostrar_ventajas", "Ventajas con icono", "Las características clave, con los iconos en tu color."],
              ] as const
            ).map(([k, etiqueta, ayuda]) => (
              <label key={k} className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="block font-semibold">{etiqueta}</span>
                  <span className="block text-xs text-muted-foreground">{ayuda}</span>
                </span>
                <Switch checked={opc[k]} onCheckedChange={(v) => setOpc({ ...opc, [k]: v })} />
              </label>
            ))}
          </section>
        )}

        <div className="hidden lg:flex lg:justify-end">
          <Button onClick={guardar} disabled={pending || !hayCambios || bloqueado} variant="success">
            Guardar
          </Button>
        </div>
      </div>

      {/* Vista previa: a la derecha y pegada en escritorio. */}
      <aside className="hidden lg:sticky lg:top-4 lg:block lg:space-y-3" aria-label="Vista previa">
        {vista ?? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Crea al menos un producto para ver aquí la vista previa de la ficha.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">{selectorMuestra}</div>
          {botonPdf()}
        </div>
        <p className="text-xs text-muted-foreground">
          La maqueta enseña la estructura y el color; el PDF real, cada detalle.
        </p>
      </aside>

      {/* Barra fija en móvil: miniatura viva, «Ver ficha» y «Guardar». */}
      <div className="fixed inset-x-0 bottom-[calc(var(--nav-inferior)+var(--safe-bottom))] z-20 border-t border-border bg-card/95 px-4 py-2 backdrop-blur md:bottom-0 md:pb-[calc(0.5rem+var(--safe-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => setVerFicha(true)}
            className="w-10 shrink-0"
            aria-label="Ver la ficha a pantalla completa"
          >
            {modelo && esPlantillaNueva(plantilla) ? (
              <VistaPreviaFicha modelo={modelo} plantilla={plantillaNueva} paleta={paleta} topeFilas={10} />
            ) : (
              <div className="aspect-[210/297] w-full rounded-sm bg-muted ring-1 ring-border" />
            )}
          </button>
          <Button variant="outline" className="flex-1" onClick={() => setVerFicha(true)}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Ver ficha
          </Button>
          <Button className="flex-1" variant="success" onClick={guardar} disabled={pending || !hayCambios || bloqueado}>
            Guardar
          </Button>
        </div>
      </div>

      <Dialog open={verFicha} onOpenChange={setVerFicha}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto p-4">
          <DialogTitle className="text-base">Tu ficha en «{NOMBRE_PLANTILLA[plantilla]}»</DialogTitle>
          {vista}
          {selectorMuestra}
          {botonPdf("w-full")}
        </DialogContent>
      </Dialog>
    </div>
  );
}
