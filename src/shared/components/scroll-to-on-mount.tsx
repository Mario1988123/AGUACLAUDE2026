"use client";

import { useEffect } from "react";

/**
 * Al cargar la página hace scroll suave hasta el bloque útil (calendario,
 * tabla, listado...) saltándose la cabecera, botones y filtros que el usuario
 * no necesita ver primero. Pensado sobre todo para tablet/móvil.
 *
 * Robusto: usa `scrollIntoView`, así funciona sea cual sea el contenedor que
 * scrollea (ventana o un <main> con overflow). Si el ancla YA está visible
 * cerca de arriba (p. ej. al volver con el botón atrás), no roba el scroll.
 *
 * Uso:
 *   <div id="contenido" className="scroll-mt-20" />
 *   <ScrollToOnMount targetId="contenido" />
 */
export function ScrollToOnMount({
  targetId,
  behavior = "smooth",
}: {
  targetId: string;
  behavior?: ScrollBehavior;
}) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Ya está visible arriba → no hacemos nada (evita saltos al volver atrás).
    if (rect.top >= 0 && rect.top <= 120) return;
    const raf = window.requestAnimationFrame(() => {
      try {
        el.scrollIntoView({ behavior, block: "start" });
      } catch {
        /* navegadores sin scrollIntoView suave: ignorar */
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [targetId, behavior]);

  return null;
}
