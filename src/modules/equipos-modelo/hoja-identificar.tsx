"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, Droplets, GlassWater, Package, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { notify } from "@/shared/hooks/use-toast";
import { corregirModeloEquipoAction, identificarEquipoAction } from "./actions";
import {
  TIPO_LABEL,
  gamasDeTipo,
  variantesDe,
  type CatalogoModelo,
  type ProductoModelo,
  type TipoEquipo,
} from "./logica";
import type { DatosHojaIdentificar } from "./datos";

/**
 * Hoja inferior «Identificar el equipo» (plan modelo de equipo, sección 4).
 * Una decisión por pantalla: [equipo] → tipo → gama → variante. Móvil
 * primero: botones de ancho completo y ≥ 48 px.
 *
 * Modos:
 *  - tecnico: desde el mantenimiento; obligatorio llegar a la variante (o a la
 *    gama si no tiene), sin «no sé» (decisión 4).
 *  - oficina: desde la ficha; además puede guardar solo el tipo.
 *  - corregir: solo admin, pide motivo (decisión 5).
 */
type Paso = "equipo" | "tipo" | "gama" | "variante" | "externo" | "motivo";

export function HojaIdentificarEquipo({
  open,
  onOpenChange,
  datos,
  customerId,
  modo,
  maintenanceJobId,
  equipoId,
  tipoInicial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  datos: DatosHojaIdentificar;
  customerId: string;
  modo: "tecnico" | "oficina" | "corregir";
  maintenanceJobId?: string | null;
  /** Equipo ya conocido. Undefined = hay que elegir cuál (o crear uno). */
  equipoId?: string | null;
  tipoInicial?: TipoEquipo | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const cat: CatalogoModelo = useMemo(
    () => ({ productos: datos.productos, tipoCategoria: datos.tipoCategoria }),
    [datos],
  );
  const pedirEquipo = equipoId === undefined && modo !== "corregir";
  const [paso, setPaso] = useState<Paso>(pedirEquipo ? "equipo" : "tipo");
  const [equipoElegido, setEquipoElegido] = useState<string | null>(equipoId ?? null);
  const [tipo, setTipo] = useState<TipoEquipo | null>(tipoInicial ?? null);
  const [gama, setGama] = useState<ProductoModelo | null>(null);
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState("");
  const [eleccion, setEleccion] = useState<
    { product_id: string; nombre: string } | { external_id: string; nombre: string } | null
  >(null);

  const gamas = useMemo(() => {
    if (!tipo) return [];
    const t = busca.trim().toLowerCase();
    const todas = gamasDeTipo(tipo, cat);
    if (!t) return todas;
    return todas.filter(
      (g) =>
        g.name.toLowerCase().includes(t) ||
        variantesDe(g.id, cat).some((v) => v.name.toLowerCase().includes(t)),
    );
  }, [tipo, busca, cat]);

  const externos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? datos.externos.filter((e) => e.nombre.toLowerCase().includes(t)) : datos.externos;
  }, [busca, datos.externos]);

  function atras() {
    setBusca("");
    if (paso === "variante") setPaso("gama");
    else if (paso === "gama" || paso === "externo") setPaso("tipo");
    else if (paso === "tipo" && pedirEquipo) setPaso("equipo");
    else if (paso === "motivo") {
      if (eleccion && "external_id" in eleccion) setPaso("externo");
      else if (gama && variantesDe(gama.id, cat).length > 0) setPaso("variante");
      else setPaso("gama");
    }
  }

  function guardar(sel: { product_id?: string; external_id?: string; solo_tipo?: TipoEquipo }, motivoTxt?: string) {
    startTransition(async () => {
      const res =
        modo === "corregir"
          ? await corregirModeloEquipoAction({
              equipo_id: equipoElegido ?? "",
              product_id: sel.product_id ?? null,
              external_equipment_model_id: sel.external_id ?? null,
              motivo: motivoTxt ?? "",
            })
          : await identificarEquipoAction({
              customer_id: customerId,
              equipo_id: equipoElegido,
              maintenance_job_id: maintenanceJobId ?? null,
              product_id: sel.product_id ?? null,
              external_equipment_model_id: sel.external_id ?? null,
              solo_tipo: sel.solo_tipo ?? null,
            });
      if (!res.ok) {
        notify.error("No se pudo guardar el equipo", res.error);
        return;
      }
      notify.success(
        sel.solo_tipo
          ? `Guardado como ${TIPO_LABEL[sel.solo_tipo].toLowerCase()}, pendiente del modelo`
          : modo === "corregir"
            ? "Modelo corregido"
            : "Equipo identificado",
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  function enlazar(id: string) {
    startTransition(async () => {
      const res = await identificarEquipoAction({
        customer_id: customerId,
        equipo_id: id,
        maintenance_job_id: maintenanceJobId ?? null,
        solo_enlazar: true,
      });
      if (!res.ok) {
        notify.error("No se pudo enlazar el equipo", res.error);
        return;
      }
      notify.success("Equipo enlazado al mantenimiento");
      onOpenChange(false);
      router.refresh();
    });
  }

  function elegir(sel: { product_id: string; nombre: string } | { external_id: string; nombre: string }) {
    if (modo === "corregir") {
      setEleccion(sel);
      setPaso("motivo");
      return;
    }
    guardar("product_id" in sel ? { product_id: sel.product_id } : { external_id: sel.external_id });
  }

  const titulo =
    paso === "equipo"
      ? "¿Qué equipo es?"
      : paso === "tipo"
        ? "¿Es fuente u ósmosis?"
        : paso === "gama"
          ? `¿Qué ${tipo === "osmosis" ? "ósmosis" : "fuente"} es?`
          : paso === "variante"
            ? `¿Cuál de ${gama?.name ?? "la gama"}?`
            : paso === "externo"
              ? "Equipo de otra marca"
              : "Motivo de la corrección";

  const botonBase =
    "flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-left transition active:scale-[0.99] hover:bg-muted/40 disabled:opacity-50";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center gap-2">
            {paso !== (pedirEquipo ? "equipo" : "tipo") && (
              <button
                type="button"
                onClick={atras}
                className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
                aria-label="Atrás"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <SheetTitle className="text-lg">{titulo}</SheetTitle>
          </div>
          <SheetDescription>
            {modo === "corregir"
              ? "Queda registrado quién lo cambia y por qué."
              : "Se guarda en el acto y queda asignado para siempre."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {paso === "equipo" && (
            <>
              {datos.equipos.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={botonBase}
                  disabled={pending}
                  onClick={() => {
                    setEquipoElegido(e.id);
                    if (!e.pendiente && maintenanceJobId) {
                      // Ya identificado: solo se enlaza el mantenimiento a él.
                      enlazar(e.id);
                      return;
                    }
                    setTipo(e.tipo);
                    setPaso("tipo");
                  }}
                >
                  <Package className="h-5 w-5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.etiqueta}</span>
                    {e.serial_number && (
                      <span className="block text-xs text-muted-foreground">S/N {e.serial_number}</span>
                    )}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className={`${botonBase} border-dashed`}
                onClick={() => {
                  setEquipoElegido(null);
                  setPaso("tipo");
                }}
              >
                <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="font-semibold">Otro equipo (darlo de alta)</span>
              </button>
            </>
          )}

          {paso === "tipo" && (
            <>
              {(["fuente", "osmosis"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${botonBase} ${tipo === t ? "border-primary bg-primary/5" : ""}`}
                  onClick={() => {
                    setTipo(t);
                    setBusca("");
                    setPaso("gama");
                  }}
                >
                  {t === "fuente" ? (
                    <GlassWater className="h-6 w-6 shrink-0 text-sky-600" />
                  ) : (
                    <Droplets className="h-6 w-6 shrink-0 text-teal-600" />
                  )}
                  <span className="flex-1 text-base font-bold">{TIPO_LABEL[t]}</span>
                  {tipo === t && <Check className="h-5 w-5 text-primary" />}
                </button>
              ))}
              <button
                type="button"
                className={`${botonBase} border-dashed`}
                onClick={() => {
                  setBusca("");
                  setPaso("externo");
                }}
              >
                <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="font-semibold">Equipo de otra marca</span>
              </button>
              {modo === "oficina" && tipo && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="mt-2 w-full"
                  disabled={pending}
                  onClick={() => guardar({ solo_tipo: tipo })}
                >
                  Guardar solo «{TIPO_LABEL[tipo]}» (sin modelo)
                </Button>
              )}
            </>
          )}

          {(paso === "gama" || paso === "externo") && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar"
                className="h-12 pl-9 text-base"
              />
            </div>
          )}

          {paso === "gama" &&
            (gamas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No hay modelos de {tipo === "osmosis" ? "ósmosis" : "fuente"} en el catálogo
                {busca ? " con ese nombre" : ""}. La oficina debe marcar el tipo en la categoría o el
                producto.
              </p>
            ) : (
              gamas.map((g) => {
                const nVar = variantesDe(g.id, cat).length;
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={pending}
                    className={botonBase}
                    onClick={() => {
                      setBusca("");
                      if (nVar > 0) {
                        setGama(g);
                        setPaso("variante");
                      } else {
                        setGama(g);
                        elegir({ product_id: g.id, nombre: g.name });
                      }
                    }}
                  >
                    <Foto p={g} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{g.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {nVar > 0 ? `${nVar} variantes` : "Sin variantes"}
                      </span>
                    </span>
                  </button>
                );
              })
            ))}

          {paso === "variante" &&
            gama &&
            variantesDe(gama.id, cat).map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={pending}
                className={botonBase}
                onClick={() => elegir({ product_id: v.id, nombre: `${gama.name} · ${v.name}` })}
              >
                <Foto p={v} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{v.name}</span>
                  {v.rasgos_identificacion && (
                    <span className="block text-xs text-muted-foreground">
                      {v.rasgos_identificacion}
                    </span>
                  )}
                </span>
              </button>
            ))}

          {paso === "externo" &&
            (externos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No hay modelos de otra marca dados de alta. Avisa a la oficina.
              </p>
            ) : (
              externos.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  disabled={pending}
                  className={botonBase}
                  onClick={() => elegir({ external_id: e.id, nombre: e.nombre })}
                >
                  <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="font-semibold">{e.nombre}</span>
                </button>
              ))
            ))}

          {paso === "motivo" && eleccion && (
            <div className="space-y-3">
              <p className="text-sm">
                Nuevo modelo: <strong>{eleccion.nombre}</strong>
              </p>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base"
                placeholder="Por qué se corrige (p. ej. el técnico eligió mal la variante)"
              />
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={pending || motivo.trim().length < 3}
                onClick={() =>
                  guardar(
                    "product_id" in eleccion
                      ? { product_id: eleccion.product_id }
                      : { external_id: eleccion.external_id },
                    motivo,
                  )
                }
              >
                {pending ? "Guardando..." : "Corregir modelo"}
              </Button>
            </div>
          )}

          {pending && paso !== "motivo" && (
            <p className="py-2 text-center text-sm text-muted-foreground">Guardando...</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Foto({ p }: { p: ProductoModelo }) {
  if (!p.main_image_url) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Package className="h-5 w-5 text-muted-foreground" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={p.main_image_url}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg bg-muted object-contain"
      loading="lazy"
    />
  );
}
