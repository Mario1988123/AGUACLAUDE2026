"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import {
  guardarReservaFurgoneta,
  quitarReservaFurgoneta,
  type DatosReserva,
} from "./reserva-furgoneta-actions";

const EMPRESA = "empresa";

/** Editor de la carga de reserva (oficina). Móvil primero, pulsables de 44 px. */
export function ReservaFurgonetaEditor({ datos }: { datos: DatosReserva }) {
  const router = useRouter();
  const [ambito, setAmbito] = useState<string>(EMPRESA);
  const [articulo, setArticulo] = useState<string>("");
  const [cantidad, setCantidad] = useState<number>(1);
  const [pending, startTransition] = useTransition();

  const warehouseId = ambito === EMPRESA ? null : ambito;
  const filas = useMemo(
    () => datos.filas.filter((f) => (f.warehouse_id ?? null) === warehouseId),
    [datos.filas, warehouseId],
  );
  const deEmpresa = useMemo(() => datos.filas.filter((f) => !f.warehouse_id), [datos.filas]);

  function guardar(tipo: "producto" | "filtro", articulo_id: string, c: number) {
    startTransition(async () => {
      const r = await guardarReservaFurgoneta({ warehouse_id: warehouseId, tipo, articulo_id, cantidad: c });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      setArticulo("");
      setCantidad(1);
      router.refresh();
    });
  }

  function quitar(id: string) {
    startTransition(async () => {
      const r = await quitarReservaFurgoneta(id);
      if (!r.ok) {
        notify.error("No se pudo quitar", r.error);
        return;
      }
      router.refresh();
    });
  }

  function anadir() {
    const [tipo, id] = articulo.split(":") as ["producto" | "filtro", string];
    if (!tipo || !id) return;
    guardar(tipo, id, cantidad);
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Reserva de</span>
        <select
          value={ambito}
          onChange={(e) => setAmbito(e.target.value)}
          className="h-12 w-full rounded-xl border border-border bg-card px-3 text-base"
        >
          <option value={EMPRESA}>Toda la empresa (todas las furgonetas)</option>
          {datos.furgonetas.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nombre}
            </option>
          ))}
        </select>
      </label>

      {warehouseId && deEmpresa.length > 0 && (
        <p className="text-xs text-muted-foreground">
          De la empresa ya lleva: {deEmpresa.map((f) => `${f.nombre} × ${f.cantidad}`).join(", ")}. Añade aquí solo lo
          que cambie en esta furgoneta.
        </p>
      )}

      {filas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Sin reserva {warehouseId ? "propia en esta furgoneta" : "para la empresa"}.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {filas.map((f) => (
            <li key={f.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{f.nombre}</p>
                <p className="text-xs text-muted-foreground">{f.tipo === "filtro" ? "Filtro" : "Producto"}</p>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={warehouseId ? 0 : 1}
                max={500}
                defaultValue={f.cantidad}
                disabled={pending}
                aria-label={`Cantidad de ${f.nombre}`}
                onBlur={(e) => {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isFinite(v) && v !== f.cantidad) guardar(f.tipo, f.articulo_id, v);
                }}
                className="h-11 w-20 rounded-xl border border-border bg-background px-2 text-center text-base tabular-nums"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => quitar(f.id)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-40"
                aria-label={`Quitar ${f.nombre} de la reserva`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Añadir a la reserva</p>
        <select
          value={articulo}
          onChange={(e) => setArticulo(e.target.value)}
          className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base"
          aria-label="Artículo"
        >
          <option value="">Elige un producto o un filtro…</option>
          {datos.filtros.length > 0 && (
            <optgroup label="Filtros">
              {datos.filtros.map((f) => (
                <option key={f.id} value={`filtro:${f.id}`}>
                  {f.nombre}
                  {f.referencia ? ` · ${f.referencia}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Productos">
            {datos.productos.map((p) => (
              <option key={p.id} value={`producto:${p.id}`}>
                {p.nombre}
                {p.referencia ? ` · ${p.referencia}` : ""}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={warehouseId ? 0 : 1}
            max={500}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))))}
            aria-label="Cantidad"
            className="h-12 rounded-xl border border-border bg-background px-2 text-center text-base tabular-nums"
          />
          <button
            type="button"
            disabled={pending || !articulo}
            onClick={anadir}
            className="h-12 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Añadir"}
          </button>
        </div>
      </div>
    </div>
  );
}
