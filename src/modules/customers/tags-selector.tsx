"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Check } from "lucide-react";
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

  if (catalog.length === 0 && assigned.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Aún no hay etiquetas creadas. Crea el catálogo en{" "}
        <a href="/configuracion/clientes" className="underline">
          /configuracion/clientes
        </a>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assigned.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => toggle(t)}
          disabled={pending}
          className={`inline-flex items-center gap-1 rounded-md border-2 px-2 py-0.5 text-xs font-semibold ${COLOR_CLASSES[t.color] ?? COLOR_CLASSES.slate} hover:opacity-80`}
          title="Quitar etiqueta"
        >
          <Tag className="h-3 w-3" />
          {t.label}
        </button>
      ))}
      {catalog.length > 0 && (
        <>
          {!open ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
              disabled={pending}
              className="h-7 px-2 text-xs"
            >
              + Etiqueta
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-2">
              {catalog.map((t) => {
                const isOn = assignedIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t)}
                    disabled={pending}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                      isOn
                        ? COLOR_CLASSES[t.color] ?? COLOR_CLASSES.slate
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {isOn && <Check className="h-3 w-3" />}
                    {t.label}
                  </button>
                );
              })}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                className="h-7 px-2 text-xs"
              >
                Cerrar
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
