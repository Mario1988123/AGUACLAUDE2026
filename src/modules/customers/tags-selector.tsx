"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { toggleCustomerTagAction, type CustomerTag } from "./tags-actions";

const COLOR_CLASSES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-900 border-slate-300",
  red: "bg-red-100 text-red-900 border-red-300",
  amber: "bg-amber-100 text-amber-900 border-amber-300",
  emerald: "bg-emerald-100 text-emerald-900 border-emerald-300",
  blue: "bg-blue-100 text-blue-900 border-blue-300",
  violet: "bg-violet-100 text-violet-900 border-violet-300",
  pink: "bg-pink-100 text-pink-900 border-pink-300",
};

interface Props {
  customerId: string;
  catalog: CustomerTag[];
  assigned: CustomerTag[];
}

/**
 * Selector de etiquetas compacto: un solo chip en la cabecera del cliente
 * (no ocupa fila propia). Al hacer click se abre un modal con el catálogo
 * completo y se marcan/desmarcan. La fila principal del cliente queda limpia.
 *
 * Decisión 2026-06-02: la versión inline (flex-wrap con todo el catálogo
 * desplegado) ocupaba demasiado espacio vertical y empujaba el scroll.
 */
export function CustomerTagsSelector({ customerId, catalog, assigned }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const assignedIds = new Set(assigned.map((t) => t.id));

  function toggle(tag: CustomerTag) {
    const attach = !assignedIds.has(tag.id);
    startTransition(async () => {
      const r = await toggleCustomerTagAction({
        customer_id: customerId,
        tag_id: tag.id,
        attach,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      router.refresh();
    });
  }

  // Si no hay catálogo ni asignadas → mostrar chip mini que lleva a config.
  if (catalog.length === 0 && assigned.length === 0) {
    return (
      <a
        href="/configuracion/clientes"
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 text-xs text-muted-foreground hover:bg-muted"
        title="Crear catálogo de etiquetas en /configuracion/clientes"
      >
        <Tag className="h-3 w-3" /> Sin etiquetas
      </a>
    );
  }

  // Texto del chip principal: nombre de la 1ª etiqueta + " +N" si hay más,
  // o "+ Etiqueta" si no hay ninguna asignada.
  const first = assigned[0];
  const extra = assigned.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 max-w-[240px] items-center gap-1 rounded-full border px-2 text-xs font-semibold hover:bg-muted"
        title="Editar etiquetas"
      >
        <Tag className="h-3 w-3 shrink-0" />
        {first ? (
          <>
            <span
              className={`truncate rounded px-1.5 ${COLOR_CLASSES[first.color] ?? COLOR_CLASSES.slate}`}
            >
              {first.label}
            </span>
            {extra > 0 && (
              <span className="text-muted-foreground">+{extra}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">+ Etiqueta</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" /> Etiquetas del cliente
            </DialogTitle>
            <DialogDescription className="text-xs">
              Marca o desmarca para asignar etiquetas. El catálogo se gestiona
              en{" "}
              <a
                href="/configuracion/clientes"
                className="text-primary underline"
              >
                /configuracion/clientes
              </a>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5 py-2">
            {catalog.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aún no hay etiquetas en el catálogo.
              </p>
            ) : (
              catalog.map((t) => {
                const isOn = assignedIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t)}
                    disabled={pending}
                    className={`inline-flex items-center gap-1 rounded-md border-2 px-2 py-1 text-xs font-semibold transition ${
                      isOn
                        ? COLOR_CLASSES[t.color] ?? COLOR_CLASSES.slate
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {isOn && <Check className="h-3 w-3" />}
                    {t.label}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
