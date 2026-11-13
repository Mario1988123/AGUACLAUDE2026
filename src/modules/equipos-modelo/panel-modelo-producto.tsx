"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  crearVarianteAction,
  guardarModeloProductoAction,
  guardarTipoCategoriaAction,
} from "./producto-actions";
import { TIPO_LABEL, type TipoEquipo } from "./logica";
import type { PanelModeloProducto } from "./datos";

const selectCls =
  "h-12 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm";

/**
 * Ficha de producto → «Modelo de equipo»: tipo (fuente/ósmosis), si es
 * variante de una gama, rasgos para el técnico y, en la gama, sus variantes
 * con el stock de cada una y el total de la gama.
 */
export function PanelModeloProductoCard({
  datos,
  canEdit,
}: {
  datos: PanelModeloProducto;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const p = datos.producto;
  const [tipo, setTipo] = useState<string>(p.tipo_equipo ?? "");
  const [gamaId, setGamaId] = useState<string>(p.gama_id ?? "");
  const [rasgos, setRasgos] = useState(p.rasgos_identificacion ?? "");
  const [tipoCat, setTipoCat] = useState<string>(datos.categoria?.tipo_equipo ?? "");
  const [nuevaNombre, setNuevaNombre] = useState("");
  const [nuevaRasgos, setNuevaRasgos] = useState("");

  const esGama = datos.variantes.length > 0;
  const totalGama = datos.stockGama + datos.variantes.reduce((s, v) => s + v.stock, 0);

  function guardar() {
    startTransition(async () => {
      const r = await guardarModeloProductoAction(p.id, {
        tipo_equipo: tipo ? (tipo as TipoEquipo) : null,
        gama_id: gamaId || null,
        rasgos_identificacion: rasgos,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Modelo de equipo guardado");
      router.refresh();
    });
  }

  function guardarCategoria() {
    if (!datos.categoria) return;
    const catId = datos.categoria.id;
    startTransition(async () => {
      const r = await guardarTipoCategoriaAction(catId, tipoCat ? (tipoCat as TipoEquipo) : null);
      if (!r.ok) {
        notify.error("No se pudo guardar la categoría", r.error);
        return;
      }
      notify.success("Tipo de la categoría guardado");
      router.refresh();
    });
  }

  function crearVariante() {
    startTransition(async () => {
      const r = await crearVarianteAction(p.id, {
        name: nuevaNombre,
        rasgos_identificacion: nuevaRasgos,
      });
      if (!r.ok) {
        notify.error("No se pudo crear la variante", r.error);
        return;
      }
      notify.success("Variante creada");
      setNuevaNombre("");
      setNuevaRasgos("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">
        Tipo efectivo:{" "}
        <strong className="text-foreground">
          {p.tipo_efectivo ? TIPO_LABEL[p.tipo_efectivo] : "no es equipo principal"}
        </strong>
        {p.gama_id && p.gama_nombre && (
          <>
            {" · "}Variante de{" "}
            <Link href={`/productos/${p.gama_id}`} className="font-semibold text-primary underline">
              {p.gama_nombre}
            </Link>{" "}
            (filtros, precio y kit se heredan de la gama)
          </>
        )}
      </p>

      {canEdit && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tipo de este producto</Label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}>
              <option value="">Heredar (gama o categoría)</option>
              <option value="fuente">Fuente</option>
              <option value="osmosis">Ósmosis</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Es variante de</Label>
            <select
              value={gamaId}
              onChange={(e) => setGamaId(e.target.value)}
              disabled={esGama}
              className={selectCls}
            >
              <option value="">— No, es una gama o va suelto —</option>
              {datos.gamasPosibles.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {esGama && (
              <p className="text-xs text-muted-foreground">Tiene variantes: es una gama.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Cómo reconocerlo (lo ve el técnico al identificar)</Label>
            <Input
              value={rasgos}
              onChange={(e) => setRasgos(e.target.value)}
              placeholder="Color, forma, grifo, pegatina..."
            />
          </div>
          <Button type="button" onClick={guardar} disabled={pending} className="sm:col-span-2">
            Guardar modelo de equipo
          </Button>
        </div>
      )}

      {canEdit && datos.categoria && (
        <div className="space-y-1.5 rounded-xl border border-border p-3">
          <Label>Tipo de la categoría «{datos.categoria.name}» (para todos sus productos)</Label>
          <div className="flex gap-2">
            <select value={tipoCat} onChange={(e) => setTipoCat(e.target.value)} className={selectCls}>
              <option value="">No es equipo principal</option>
              <option value="fuente">Fuente</option>
              <option value="osmosis">Ósmosis</option>
            </select>
            <Button type="button" variant="outline" onClick={guardarCategoria} disabled={pending} className="h-12">
              Guardar
            </Button>
          </div>
        </div>
      )}

      {!p.gama_id && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">Variantes ({datos.variantes.length})</h3>
            {esGama && (
              <span className="text-muted-foreground">
                Total gama: <strong className="text-foreground">{totalGama}</strong>
                {datos.stockGama > 0 && <> (sin variante asignada: {datos.stockGama})</>}
              </span>
            )}
          </div>
          {datos.variantes.length === 0 ? (
            <p className="text-muted-foreground">Sin variantes.</p>
          ) : (
            <ul className="divide-y rounded-xl border border-border">
              {datos.variantes.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <Link href={`/productos/${v.id}`} className="font-semibold text-primary hover:underline">
                      {v.name}
                    </Link>
                    {!v.activo && <span className="ml-2 text-xs text-destructive">inactiva</span>}
                    {v.rasgos && <p className="text-xs text-muted-foreground">{v.rasgos}</p>}
                  </div>
                  <span className="shrink-0 font-mono">{v.stock} uds</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="grid gap-2 rounded-xl border border-dashed border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={nuevaNombre}
                onChange={(e) => setNuevaNombre(e.target.value)}
                placeholder="Nombre exacto (p. ej. FIORD)"
              />
              <Input
                value={nuevaRasgos}
                onChange={(e) => setNuevaRasgos(e.target.value)}
                placeholder="Cómo reconocerla (opcional)"
              />
              <Button
                type="button"
                onClick={crearVariante}
                disabled={pending || !nuevaNombre.trim()}
                className="h-12"
              >
                <Plus className="h-4 w-4" /> Añadir variante
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
