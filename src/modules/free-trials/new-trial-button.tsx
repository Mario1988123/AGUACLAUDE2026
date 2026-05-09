"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, User, UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";

/**
 * Botón "+ Nueva prueba" del listado /pruebas-gratuitas. Como una prueba
 * tiene que pertenecer SIEMPRE a un cliente o un lead existente, este
 * botón solo expande un mini-menú que enlaza:
 *  - "A un cliente existente" → /clientes (selector)
 *  - "A un lead existente" → /leads (selector)
 *
 * En la ficha de cliente/lead aparece otro botón "+ Nueva prueba" que
 * lleva directo a /pruebas-gratuitas/nueva con el owner ya rellenado.
 */
export function NewFreeTrialButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button onClick={() => setOpen((v) => !v)} variant="success">
        <Plus className="h-4 w-4" /> Nueva prueba
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-2xl border border-border bg-card p-2 shadow-2xl">
            <p className="px-2 py-1 text-xs text-muted-foreground">
              ¿Para quién es la prueba?
            </p>
            <Link
              href={"/clientes" as never}
              className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <User className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Cliente existente</div>
                <div className="text-xs text-muted-foreground">
                  Abre /clientes y entra en su ficha
                </div>
              </div>
            </Link>
            <Link
              href={"/leads" as never}
              className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <UserPlus className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Lead existente</div>
                <div className="text-xs text-muted-foreground">
                  Abre /leads y entra en su ficha
                </div>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
