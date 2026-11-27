"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/shared/lib/supabase/client";

/**
 * Refresca la página (router.refresh) cuando cambia algo en una tabla de la
 * bandeja. Supabase Realtime respeta la RLS: solo llegan las filas que la
 * sesión puede leer. Si el canal no se suscribe, consulta cada 15 s.
 */
export function useRefrescoEnVivo(canal: string, tabla: string, filtro?: string) {
  const router = useRouter();
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let vivo = true;
    let sondeo: ReturnType<typeof setInterval> | null = null;
    const refrescar = () => {
      if (!vivo) return;
      if (espera.current) clearTimeout(espera.current);
      // Agrupa ráfagas (el historial llega a cientos de filas de golpe).
      espera.current = setTimeout(() => router.refresh(), 400);
    };
    const supabase = createBrowserSupabase();
    const ch = supabase
      .channel(canal)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabla, ...(filtro ? { filter: filtro } : {}) },
        refrescar,
      )
      .subscribe((estado) => {
        if (estado === "SUBSCRIBED") {
          if (sondeo) clearInterval(sondeo);
          sondeo = null;
        } else if ((estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") && !sondeo) {
          sondeo = setInterval(() => vivo && router.refresh(), 15_000);
        }
      });
    return () => {
      vivo = false;
      if (espera.current) clearTimeout(espera.current);
      if (sondeo) clearInterval(sondeo);
      void supabase.removeChannel(ch);
    };
  }, [canal, tabla, filtro, router]);
}
