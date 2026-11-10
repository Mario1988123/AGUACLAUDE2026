"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** id del panel; la hamburguesa lo referencia con `aria-controls`. */
  id: string;
  abierto: boolean;
  alCerrar: () => void;
  /** Nombre accesible del diálogo ("Menú de navegación"). */
  etiqueta: string;
  /**
   * Ancho (px) a partir del cual el cajón deja de existir porque hay barra
   * lateral completa. Si la ventana crece hasta ahí con el cajón abierto
   * (girar la tablet), se cierra solo para no dejar el foco y el
   * desplazamiento atrapados en algo que ya no se ve.
   */
  hastaPx: number;
  /** Clases del contenedor: aquí va el `lg:hidden` / `md:hidden`. */
  className?: string;
  /** Clases del panel (fondo, borde). */
  classNamePanel?: string;
  children: React.ReactNode;
}

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Recorrido horizontal mínimo antes de decidir que el gesto es un arrastre. */
const UMBRAL_PX = 10;

/**
 * Cajón lateral del marco (la Regla de la Puerta Única). Uno para el CRM y
 * para el superadmin. Ver docs/DISENO_NAVEGACION_MOVIL.md.
 *
 * Está siempre montado y se mueve con `transition` de CSS (clases `.cajon*`
 * de globals.css), no con keyframes: así se puede cerrar a media apertura y
 * arrastrar a media animación sin saltos. Cerrado queda `inert` y
 * `visibility: hidden`, fuera del orden de tabulación y del lector.
 */
export function CajonLateral({
  id,
  abierto,
  alCerrar,
  etiqueta,
  hastaPx,
  className,
  classNamePanel,
  children,
}: Props) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Siempre la última función de cierre, sin reenganchar los efectos.
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  // Foco, Escape, tabulación atrapada y bloqueo del fondo mientras está abierto.
  useEffect(() => {
    if (!abierto) return;
    const nodo = panel.current;
    if (!nodo) return;

    const anterior = document.activeElement as HTMLElement | null;
    const desbordePrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // El foco entra al panel, no a un enlace: así el lector anuncia el
    // diálogo y el primer Tab cae en el botón de cerrar.
    nodo.focus({ preventScroll: true });
    // La lista se abre enseñando el módulo en el que se está.
    nodo.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });

    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar.current();
        return;
      }
      if (e.key !== "Tab" || !nodo) return;
      const lista = Array.from(nodo.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
        (el) => el.offsetParent !== null,
      );
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = lista[0]!;
      const ultimo = lista[lista.length - 1]!;
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === nodo)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (!nodo.contains(activo)) {
        e.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener("keydown", alTeclear);

    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = desbordePrevio;
      // El foco vuelve a quien abrió (la hamburguesa), si sigue en pantalla.
      if (anterior && anterior.isConnected && nodo.contains(document.activeElement)) {
        anterior.focus({ preventScroll: true });
      }
    };
  }, [abierto]);

  // Si aparece la barra lateral completa (giro, redimensión), el cajón sobra.
  useEffect(() => {
    if (!abierto) return;
    const mq = window.matchMedia(`(min-width: ${hastaPx}px)`);
    if (mq.matches) {
      cerrar.current();
      return;
    }
    const alCambiar = () => {
      if (mq.matches) cerrar.current();
    };
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, [abierto, hastaPx]);

  // Arrastre hacia la izquierda para cerrar: el panel sigue al dedo 1:1 y al
  // soltar decide por velocidad o por recorrido.
  const gesto = useRef<{
    id: number;
    x0: number;
    y0: number;
    activo: boolean;
    xPrevio: number;
    tPrevio: number;
    velocidad: number;
  } | null>(null);

  // Tras un arrastre el navegador aún dispara `click` sobre el enlace que
  // había debajo del dedo: lo anulamos para no navegar sin querer.
  const huboArrastre = useRef(false);

  function alPulsar(e: React.PointerEvent<HTMLDivElement>) {
    huboArrastre.current = false;
    if (e.pointerType === "mouse" || !abierto) return;
    gesto.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      activo: false,
      xPrevio: e.clientX,
      tPrevio: e.timeStamp,
      velocidad: 0,
    };
  }

  function alMover(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesto.current;
    const nodo = panel.current;
    if (!g || !nodo || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.activo) {
      if (Math.abs(dx) < UMBRAL_PX && Math.abs(dy) < UMBRAL_PX) return;
      // Si el gesto es más vertical que horizontal es la lista desplazándose.
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) {
        gesto.current = null;
        return;
      }
      g.activo = true;
      nodo.dataset.arrastrando = "true";
      try {
        nodo.setPointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }
    }
    const dt = e.timeStamp - g.tPrevio;
    if (dt > 0) g.velocidad = (e.clientX - g.xPrevio) / dt;
    g.xPrevio = e.clientX;
    g.tPrevio = e.timeStamp;
    nodo.style.translate = `${Math.min(0, dx + UMBRAL_PX)}px 0`;
  }

  function alSoltar(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesto.current;
    const nodo = panel.current;
    gesto.current = null;
    if (!g || !nodo || !g.activo) return;
    delete nodo.dataset.arrastrando;
    nodo.style.translate = "";
    const dx = e.clientX - g.x0;
    // Manda el sentido de la velocidad al soltar; si va despacio, el recorrido.
    const lanzado = g.velocidad < -0.35;
    const frenado = g.velocidad > 0.2;
    if (lanzado || (!frenado && dx < -nodo.offsetWidth * 0.35)) cerrar.current();
  }

  function alCapturarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (huboArrastre.current) {
      huboArrastre.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <div className={cn("cajon", className)} data-abierto={abierto ? "true" : "false"} inert={!abierto}>
      <div className="cajon-velo" onClick={alCerrar} aria-hidden="true" />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        tabIndex={-1}
        className={cn("cajon-panel", classNamePanel)}
        onPointerDown={alPulsar}
        onPointerMove={(e) => {
          alMover(e);
          if (gesto.current?.activo) huboArrastre.current = true;
        }}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onClickCapture={alCapturarClick}
      >
        {children}
      </div>
    </div>
  );
}
