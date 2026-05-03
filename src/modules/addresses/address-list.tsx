"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Pencil, Trash2, Plus, Star } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { AddressForm } from "./address-form";
import { deleteAddressAction, type AddressRow } from "./actions";
import { KIND_LABEL, STREET_TYPE_LABEL } from "./schemas";

interface Props {
  customerId?: string;
  leadId?: string;
  addresses: AddressRow[];
}

export function AddressList({ customerId, leadId, addresses }: Props) {
  const sp = useSearchParams();
  const [editing, setEditing] = useState<AddressRow | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  // Auto-abrir el formulario cuando viene ?address=open (típico al crear lead)
  useEffect(() => {
    if (sp?.get("address") === "open" && addresses.length === 0) {
      setEditing("new");
    }
  }, [sp, addresses.length]);

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta dirección?")) return;
    startTransition(async () => {
      try {
        await deleteAddressAction(id);
        notify.success("Dirección eliminada");
        // refresh forzado
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (editing === "new") {
    return (
      <AddressForm
        customerId={customerId}
        leadId={leadId}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  if (editing) {
    return (
      <AddressForm
        customerId={customerId}
        leadId={leadId}
        initial={editing}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {addresses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Aún no hay direcciones.
        </div>
      ) : (
        addresses.map((a) => (
          <div
            key={a.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">{KIND_LABEL[a.kind]}</Badge>
                {a.label && (
                  <span className="text-sm font-semibold">{a.label}</span>
                )}
                {a.is_primary && (
                  <Badge variant="success">
                    <Star className="h-3 w-3 fill-current" /> Principal
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 text-sm">
                {STREET_TYPE_LABEL[a.street_type]} {a.street}
                {a.street_number && `, ${a.street_number}`}
                {a.portal && ` portal ${a.portal}`}
                {a.floor && ` ${a.floor}`}
                {a.door && a.floor && a.door}
              </div>
              <div className="text-xs text-muted-foreground">
                {a.postal_code} {a.city}
                {a.province && `, ${a.province}`}
              </div>
              {a.contact_name && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Contacto: {a.contact_name}
                  {a.contact_phone && ` · ${a.contact_phone}`}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="ghost" size="icon" onClick={() => setEditing(a)} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(a.id)}
                disabled={pending}
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))
      )}
      <Button onClick={() => setEditing("new")} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> Añadir dirección
      </Button>
    </div>
  );
}
