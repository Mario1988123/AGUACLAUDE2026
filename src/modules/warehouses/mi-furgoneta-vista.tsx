"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, PackageMinus, Search, X, Minus, Plus } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import {
  listarCatalogoMovimiento,
  registrarMovimientoFurgoneta,
  type ColorStock,
  type ProductoCarga,
  type ProductoFurgoneta,
} from "./furgoneta-actions";

const PUNTO: Record<ColorStock, string> = {
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  gris: "bg-zinc-300 dark:bg-zinc-600",
};
const TEXTO: Record<ColorStock, string> = {
  verde: "Hay",
  ambar: "Queda poco",
  gris: "No queda",
};

type Sentido = "carga" | "devolucion";

function coincide(p: { nombre: string; referencia: string | null }, q: string): boolean {
  return p.nombre.toLowerCase().includes(q) || (p.referencia ?? "").toLowerCase().includes(q);
}

export function MiFurgonetaVista({
  nombre,
  matricula,
  productos,
}: {
  nombre: string;
  matricula: string | null;
  productos: ProductoFurgoneta[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const [sentido, setSentido] = useState<Sentido | null>(null);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? productos.filter((p) => coincide(p, q)) : productos;
  }, [busqueda, productos]);

  if (sentido) {
    return <RegistrarMovimiento sentido={sentido} onCerrar={() => setSentido(null)} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Mi furgoneta</h1>
        <p className="text-sm text-muted-foreground">
          {nombre}
          {matricula ? ` · ${matricula}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSentido("carga")}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:opacity-90"
        >
          <PackagePlus className="h-4 w-4" /> Registrar carga
        </button>
        <button
          type="button"
          onClick={() => setSentido("devolucion")}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold active:bg-muted"
        >
          <PackageMinus className="h-4 w-4" /> Devolver
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["verde", "ambar", "gris"] as ColorStock[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${PUNTO[c]}`} aria-hidden="true" />
            {TEXTO[c]}
          </span>
        ))}
      </div>

      {productos.length > 6 && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto"
            className="h-12 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base"
          />
        </label>
      )}

      {productos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Tu furgoneta está vacía. Registra una carga cuando cojas material del almacén.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {filtrados.map((p) => (
            <li key={p.product_id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${PUNTO[p.estado]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.nombre}</p>
                {p.referencia && <p className="truncate text-xs text-muted-foreground">{p.referencia}</p>}
              </div>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{TEXTO[p.estado]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RegistrarMovimiento({ sentido, onCerrar }: { sentido: Sentido; onCerrar: () => void }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [origen, setOrigen] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<ProductoCarga[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    listarCatalogoMovimiento(sentido).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setCatalogo(r.productos);
        setOrigen(r.origen);
      } else {
        setError(r.error);
      }
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [sentido]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q ? catalogo.filter((p) => coincide(p, q)) : catalogo;
    // Primero lo que hay.
    return [...base].sort((a, b) => Number(b.hay) - Number(a.hay));
  }, [busqueda, catalogo]);

  const lineas = Object.entries(cantidades)
    .filter(([, c]) => c > 0)
    .map(([product_id, cantidad]) => ({ product_id, cantidad }));
  const total = lineas.reduce((s, l) => s + l.cantidad, 0);

  function cambiar(id: string, delta: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, Math.min(500, (prev[id] ?? 0) + delta)) }));
  }

  function guardar() {
    startTransition(async () => {
      const r = await registrarMovimientoFurgoneta({ sentido, lineas });
      if (!r.ok) {
        notify.error("No se pudo registrar", r.error);
        return;
      }
      notify.success(sentido === "carga" ? "Carga registrada" : "Devolución registrada");
      router.refresh();
      onCerrar();
    });
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {sentido === "carga" ? "Registrar carga" : "Devolver al almacén"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sentido === "carga"
              ? `Lo que coges${origen ? ` de ${origen}` : ""} para tu furgoneta.`
              : `Lo que dejas${origen ? ` en ${origen}` : ""}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {cargando && <p className="text-sm text-muted-foreground">Cargando productos…</p>}
      {error && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}</div>
      )}

      {!cargando && !error && (
        <>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto"
              className="h-12 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base"
            />
          </label>
          {catalogo.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {sentido === "carga" ? "No hay productos en el catálogo." : "No llevas nada que devolver."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {filtrados.map((p) => {
                const c = cantidades[p.product_id] ?? 0;
                return (
                  <li key={p.product_id} className="flex min-h-16 items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.nombre}</p>
                      {sentido === "carga" && (
                        <p
                          className={`text-xs ${p.hay ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                        >
                          {p.hay ? "Hay en el almacén" : "No hay en el almacén"}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => cambiar(p.product_id, -1)}
                        disabled={c === 0}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-40"
                        aria-label={`Quitar una unidad de ${p.nombre}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-8 text-center text-base font-bold tabular-nums">{c}</span>
                      <button
                        type="button"
                        onClick={() => cambiar(p.product_id, 1)}
                        disabled={sentido === "carga" && !p.hay}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-40"
                        aria-label={`Añadir una unidad de ${p.nombre}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-4 md:bottom-6 md:left-auto md:right-6 md:w-96">
        <button
          type="button"
          onClick={guardar}
          disabled={pending || total === 0}
          className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg disabled:opacity-50"
        >
          {pending
            ? "Guardando…"
            : total === 0
              ? "Elige qué productos"
              : `${sentido === "carga" ? "Confirmar carga" : "Confirmar devolución"} (${total} ud${total === 1 ? "" : "s"}.)`}
        </button>
      </div>
    </div>
  );
}
