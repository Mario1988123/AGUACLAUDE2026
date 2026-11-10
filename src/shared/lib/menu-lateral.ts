"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado del cajón de navegación del CRM (móvil y tablet).
 *
 * La hamburguesa vive en la cabecera y el cajón en la barra lateral, que son
 * hermanos dentro de un layout de servidor: no comparten padre cliente donde
 * colgar un contexto. Este almacén mínimo los une sin tocar el layout.
 */

/** id del cajón; lo usa `aria-controls` de la hamburguesa. */
export const ID_MENU_LATERAL = "menu-lateral";

let abierto = false;
const oyentes = new Set<() => void>();

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function ponerMenuLateral(valor: boolean) {
  if (abierto === valor) return;
  abierto = valor;
  oyentes.forEach((o) => o());
}

export function alternarMenuLateral() {
  ponerMenuLateral(!abierto);
}

export function useMenuLateral(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => abierto,
    () => false,
  );
}
