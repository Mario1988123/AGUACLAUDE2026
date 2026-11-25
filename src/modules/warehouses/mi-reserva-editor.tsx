"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Search, X } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { guardarMiReserva, leerMiReserva, type ArticuloReserva } from "./carga-sugerida-actions";

const clave = (a: { tipo: string; id: string }) => `${a.tipo}:${a.id}`;

function coincide(a: ArticuloReserva, q: string): boolean {
  return a.nombre.toLowerCase().includes(q) || (a.referencia ?? "").toLowerCase().includes(q);
}

/**
 * «Mi reserva» (técnico, 2026-11-25): lo que su furgoneta lleva siempre.
 * Buscador de productos y filtros, + y −, guardar. La sugerencia de carga la
 * repone. Móvil primero, pulsables de 44 px.
 */
export function MiReservaEditor({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [propia, setPropia] = useState(false);
  const [catalogo, setCatalogo] = useState<ArticuloReserva[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    leerMiReserva().then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setDisponible(r.datos.disponible);
        setPropia(r.datos.propia);
        setCatalogo(r.datos.catalogo);
        setCantidades(Object.fromEntries(r.datos.lineas.map((l) => [clave(l), l.cantidad])));
      } else {
        setError(r.error);
      }
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const porClave = useMemo(() => new Map(catalogo.map((a) => [clave(a), a])), [catalogo]);
  const enReserva = useMemo(
    () =>
      Object.entries(cantidades)
        .filter(([, c]) => c > 0)
        .map(([k]) => porClave.get(k))
        .filter((a): a is ArticuloReserva => !!a)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [cantidades, porClave],
  );
  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return catalogo.filter((a) => coincide(a, q) && !((cantidades[clave(a)] ?? 0) > 0)).slice(0, 30);
  }, [busqueda, catalogo, cantidades]);

  function cambiar(k: string, delta: number) {
    setCantidades((prev) => ({ ...prev, [k]: Math.max(0, Math.min(500, (prev[k] ?? 0) + delta)) }));
  }

  function guardar() {
    const lineas = Object.entries(cantidades)
      .filter(([, c]) => c > 0)
      .map(([k, cantidad]) => {
        const [tipo, id] = k.split(":") as ["producto" | "filtro", string];
        return { tipo, id, cantidad };
      });
    startTransition(async () => {
      const r = await guardarMiReserva({ lineas });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Reserva guardada", "La sugerencia de carga la repondrá cada día.");
      router.refresh();
      onCerrar();
    });
  }

  const total = Object.values(cantidades).reduce((s, c) => s + (c > 0 ? c : 0), 0);

  function fila(a: ArticuloReserva) {
    const k = clave(a);
    const c = cantidades[k] ?? 0;
    return (
      <li key={k} className="flex min-h-16 items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{a.nombre}</p>
          <p className="truncate text-xs text-muted-foreground">
            {a.tipo === "filtro" ? "Filtro · " : ""}
            Llevas {a.lleva}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => cambiar(k, -1)}
            disabled={c === 0}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-40"
            aria-label={`Una menos de ${a.nombre}`}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-base font-bold tabular-nums">{c}</span>
          <button
            type="button"
            onClick={() => cambiar(k, 1)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border"
            aria-label={`Una más de ${a.nombre}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Mi carga de reserva</p>
          <p className="text-xs text-muted-foreground">
            Lo que quieres llevar siempre en la furgoneta, además de lo de tus trabajos.
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border"
          aria-label="Cerrar mi reserva"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {error && <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}</div>}
      {!cargando && !error && !disponible && (
        <p className="text-sm text-muted-foreground">La reserva aún no está activada en tu empresa; habla con la oficina.</p>
      )}

      {!cargando && !error && disponible && (
        <>
          {!propia && enReserva.length > 0 && (
            <p className="rounded-xl bg-muted/60 p-3 text-xs">
              Esta es la reserva que propone la oficina. Cámbiala a tu gusto y guárdala: será la tuya.
            </p>
          )}

          {enReserva.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Aún no tienes reserva. Busca abajo los filtros y recambios que quieras llevar siempre.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {enReserva.map((a) => fila(a))}
            </ul>
          )}

          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o filtro para añadir"
              className="h-12 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-base"
            />
          </label>
          {busqueda.trim() && (
            resultados.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada con ese nombre o referencia.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {resultados.map((a) => fila(a))}
              </ul>
            )
          )}

          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Guardando…" : `Guardar mi reserva (${total} ud${total === 1 ? "" : "s"}.)`}
          </button>
        </>
      )}
    </div>
  );
}
