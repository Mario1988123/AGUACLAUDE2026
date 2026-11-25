"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, Undo2 } from "lucide-react";
import { Button } from "@/shared/ui/button";

/**
 * Botones de «Entrar como» y franja de «Volver». Llaman a la ruta
 * /api/superadmin/entrar-como y, si va bien, hacen una navegación COMPLETA
 * (window.location.assign): así no queda nada de la sesión anterior en el
 * navegador (caché del router, cliente de Supabase en memoria).
 */
async function llamar(cuerpo: Record<string, unknown>): Promise<{ ok: boolean; error?: string; destino?: string }> {
  try {
    const res = await fetch("/api/superadmin/entrar-como", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
    });
    return (await res.json()) as { ok: boolean; error?: string; destino?: string };
  } catch {
    return { ok: false, error: "Sin conexión." };
  }
}

export function BotonEntrarComo({ userId, etiqueta = "Entrar como" }: { userId: string; etiqueta?: string }) {
  const [cargando, setCargando] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={cargando}
      onClick={async () => {
        setCargando(true);
        const r = await llamar({ accion: "entrar", userId });
        if (r.ok && r.destino) {
          window.location.assign(r.destino);
          return;
        }
        setCargando(false);
        toast.error(r.error ?? "No se ha podido entrar.");
        if (r.destino) window.location.assign(r.destino);
      }}
    >
      {cargando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}
      {etiqueta}
    </Button>
  );
}

export interface EmpresaOpcion {
  id: string;
  nombre: string;
  conAdmin: boolean;
}

/**
 * «Cambiar a:» — lista de empresas; al elegir una se entra como su admin.
 * Un <select> nativo: en el móvil abre la rueda del sistema, que es lo más
 * cómodo con el pulgar.
 */
export function SelectorCambiarA({
  empresas,
  actualId,
  tono = "claro",
}: {
  empresas: EmpresaOpcion[];
  actualId?: string | null;
  tono?: "claro" | "ambar";
}) {
  const [cargando, setCargando] = useState(false);
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="shrink-0 font-semibold">Cambiar a:</span>
      <select
        aria-label="Cambiar a otra empresa"
        disabled={cargando}
        value={actualId ?? ""}
        onChange={async (e) => {
          const companyId = e.target.value;
          if (!companyId || companyId === actualId) return;
          setCargando(true);
          const r = await llamar({ accion: "entrar_empresa", companyId });
          if (r.ok && r.destino) {
            window.location.assign(r.destino);
            return;
          }
          setCargando(false);
          e.target.value = actualId ?? "";
          toast.error(r.error ?? "No se ha podido entrar.");
          if (r.destino) window.location.assign(r.destino);
        }}
        className={
          tono === "ambar"
            ? "h-9 min-w-0 max-w-[12rem] flex-1 rounded-md border border-amber-950/30 bg-amber-50 px-2 text-base text-amber-950 sm:max-w-xs sm:text-sm"
            : "h-10 min-w-0 max-w-xs flex-1 rounded-md border border-input bg-background px-2 text-base sm:text-sm"
        }
      >
        <option value="" disabled>
          {cargando ? "Entrando…" : "Elige empresa"}
        </option>
        {empresas.map((e) => (
          <option key={e.id} value={e.id} disabled={!e.conAdmin}>
            {e.nombre}
            {e.conAdmin ? "" : " (sin admin)"}
          </option>
        ))}
      </select>
      {cargando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
    </label>
  );
}

export function FranjaEntrarComo({
  nombre,
  empresa,
  empresas,
  companyId,
}: {
  nombre: string;
  empresa: string | null;
  empresas: EmpresaOpcion[];
  companyId: string | null;
}) {
  const [cargando, setCargando] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      <span className="min-w-0 truncate">
        Dentro como <strong>{nombre}</strong>
        {empresa ? <> · {empresa}</> : null}
      </span>
      {empresas.length > 0 ? <SelectorCambiarA empresas={empresas} actualId={companyId} tono="ambar" /> : null}
      <button
        type="button"
        disabled={cargando}
        onClick={async () => {
          setCargando(true);
          const r = await llamar({ accion: "volver" });
          if (!r.ok) toast.error(r.error ?? "No se ha podido volver.");
          window.location.assign(r.destino ?? "/");
        }}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-amber-950 px-3 text-xs font-semibold text-amber-50 disabled:opacity-60"
      >
        {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        Volver a superadmin
      </button>
    </div>
  );
}
