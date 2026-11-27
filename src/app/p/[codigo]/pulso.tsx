"use client";

import { useEffect } from "react";

/**
 * Lo único que hace JavaScript en /p/[codigo] (diseño §5.1 H y §5.3):
 *  · el latido de la visita (POST /api/captacion/visita), sin cookies ni
 *    almacenamiento: cada 10 s con la pestaña visible y otro al ocultarla;
 *  · retirar la barra fija cuando el cupón entra en la ventana;
 *  · dejar en texto la partida cuya foto no carga.
 * Sin JavaScript la página se lee entera; solo deja de contarse la visita.
 */
export function Pulso({ codigo }: { codigo: string }) {
  useEffect(() => {
    // --- Barra fija («Del Cupón Único») ------------------------------------
    const barra = document.getElementById("barra");
    const cupon = document.getElementById("cupon");
    let io: IntersectionObserver | null = null;
    if (barra && cupon && "IntersectionObserver" in window) {
      io = new IntersectionObserver(([e]) => {
        if (!e) return;
        barra.dataset.oculta = e.isIntersecting || e.boundingClientRect.top < 0 ? "1" : "0";
      });
      io.observe(cupon);
    }

    // --- Fotos que no cargan: la partida se queda en texto -----------------
    const quitarFoto = (img: HTMLImageElement) => {
      const panel = img.closest<HTMLElement>("[data-foto]");
      const partida = img.closest<HTMLElement>("[data-partida]");
      panel?.remove();
      partida?.setAttribute("data-sin-foto", "1");
    };
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-foto] img"));
    const alFallar = (ev: Event) => quitarFoto(ev.currentTarget as HTMLImageElement);
    for (const img of imgs) {
      if (img.complete && img.naturalWidth === 0) quitarFoto(img);
      else img.addEventListener("error", alFallar, { once: true });
    }

    // --- Latido ------------------------------------------------------------
    let segundos = 0;
    let scroll = 0;
    let desde = Date.now();
    let visible = document.visibilityState === "visible";

    const medirScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - window.innerHeight;
      if (max > 0) scroll = Math.max(scroll, Math.min(100, Math.round((window.scrollY / max) * 100)));
    };
    const acumular = () => {
      const ahora = Date.now();
      if (visible) segundos += (ahora - desde) / 1000;
      desde = ahora;
    };
    const enviar = (alSalir: boolean) => {
      acumular();
      const cuerpo = JSON.stringify({ c: codigo, s: Math.floor(segundos), y: scroll });
      if (alSalir && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/captacion/visita", new Blob([cuerpo], { type: "text/plain" }));
        return;
      }
      void fetch("/api/captacion/visita", {
        method: "POST",
        body: cuerpo,
        headers: { "content-type": "text/plain" },
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }).catch(() => undefined);
    };

    const alVisibilidad = () => {
      if (document.visibilityState === "hidden") {
        enviar(true);
        visible = false;
      } else {
        visible = true;
        desde = Date.now();
      }
    };
    const alSalir = () => enviar(true);

    medirScroll();
    if (visible) enviar(false);
    const intervalo = window.setInterval(() => {
      if (visible) enviar(false);
    }, 10_000);
    window.addEventListener("scroll", medirScroll, { passive: true });
    document.addEventListener("visibilitychange", alVisibilidad);
    window.addEventListener("pagehide", alSalir);

    return () => {
      io?.disconnect();
      window.clearInterval(intervalo);
      window.removeEventListener("scroll", medirScroll);
      document.removeEventListener("visibilitychange", alVisibilidad);
      window.removeEventListener("pagehide", alSalir);
      for (const img of imgs) img.removeEventListener("error", alFallar);
    };
  }, [codigo]);

  return null;
}
