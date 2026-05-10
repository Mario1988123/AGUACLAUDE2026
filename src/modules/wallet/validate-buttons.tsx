"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Check,
  X,
  Receipt,
  RefreshCw,
  Ban,
  ArrowLeft,
  Coins,
  Loader2,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  rejectWalletEntryAction,
  validateWalletEntryAction,
  markWalletAsCollectedAction,
  cancelWalletEntryAction,
  changeWalletMethodAction,
  createInvoiceFromWalletAction,
} from "./actions";

interface Props {
  id: string;
  status: string;
  method: string;
  canValidate: boolean;
  needsInvoice?: boolean;
  canInvoice?: boolean;
}

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "bizum", label: "Bizum" },
  { value: "transfer", label: "Transferencia" },
  { value: "direct_debit", label: "Domiciliación" },
  { value: "financing", label: "Financiación" },
];

export function ValidateWalletButtons({
  id,
  status,
  method,
  canValidate,
  needsInvoice = false,
  canInvoice = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [newMethod, setNewMethod] = useState(method);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar dropdown al click fuera
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const isCollected = status === "collected" || status === "pending_settlement";
  const isPending = status === "pending";
  const isRejected = status === "rejected" || status === "cancelled";

  function validate() {
    setMenuOpen(false);
    startTransition(async () => {
      try {
        await validateWalletEntryAction(id);
        notify.success(method === "cash" ? "Efectivo recibido" : "Confirmado en banco");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function markCollected() {
    setMenuOpen(false);
    startTransition(async () => {
      try {
        await markWalletAsCollectedAction(id);
        notify.success("Marcado como cobrado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function invoice() {
    setMenuOpen(false);
    startTransition(async () => {
      const r = await createInvoiceFromWalletAction(id);
      if (!r.ok) {
        notify.error("No se pudo facturar", r.error);
        return;
      }
      notify.success("Factura creada", "Borrador listo para revisar.");
      router.push(`/facturas/${r.invoice_id}` as never);
    });
  }

  function changeMethod() {
    if (newMethod === method) {
      setMethodOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await changeWalletMethodAction(id, newMethod);
        notify.success("Método actualizado");
        setMethodOpen(false);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function confirmReason() {
    const r = reason.trim();
    if (!r) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      try {
        if (reasonOpen === "reject") {
          await rejectWalletEntryAction(id, r);
          notify.success("Cobro rechazado");
        } else {
          await cancelWalletEntryAction(id, r);
          notify.success("Cobro cancelado");
        }
        setReasonOpen(null);
        setReason("");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Acción primaria contextual (la más probable según el estado)
  type Primary = {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: "success" | "default" | "outline";
    onClick: () => void;
  };
  let primary: Primary | null = null;
  if (isPending) {
    primary = {
      label: "Cobrar",
      icon: Coins,
      color: "success",
      onClick: markCollected,
    };
  } else if (isCollected && canValidate) {
    primary = {
      label: method === "cash" ? "Recibí" : "En banco",
      icon: Check,
      color: "success",
      onClick: validate,
    };
  } else if (needsInvoice && canInvoice && (status === "validated" || status === "settled")) {
    primary = {
      label: "Facturar",
      icon: Receipt,
      color: "success",
      onClick: invoice,
    };
  }

  // Items del menú (todo lo que no es la acción primaria)
  const menuItems: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    danger?: boolean;
    show: boolean;
  }> = [
    {
      label: method === "cash" ? "Confirmar efectivo recibido" : "Confirmar en banco",
      icon: Check,
      onClick: validate,
      show: isCollected && canValidate && primary?.label !== "En banco" && primary?.label !== "Recibí",
    },
    {
      label: "Marcar cobrado",
      icon: Coins,
      onClick: markCollected,
      show: isPending && primary?.label !== "Cobrar",
    },
    {
      label: "Reabrir como cobrado",
      icon: RefreshCw,
      onClick: markCollected,
      show: isRejected && canValidate,
    },
    {
      label: "Facturar",
      icon: Receipt,
      onClick: invoice,
      show:
        needsInvoice &&
        canInvoice &&
        (isCollected || status === "validated" || status === "settled") &&
        primary?.label !== "Facturar",
    },
    {
      label: "Cambiar método",
      icon: RefreshCw,
      onClick: () => {
        setMenuOpen(false);
        setNewMethod(method);
        setMethodOpen(true);
      },
      show: isPending || canValidate,
    },
    {
      label: "Rechazar",
      icon: X,
      onClick: () => {
        setMenuOpen(false);
        setReasonOpen("reject");
      },
      danger: true,
      show: isCollected && canValidate,
    },
    {
      label: "Cancelar",
      icon: Ban,
      onClick: () => {
        setMenuOpen(false);
        setReasonOpen("cancel");
      },
      danger: true,
      show: isPending && canValidate,
    },
  ].filter((i) => i.show);

  // Si no hay acción posible, no renderizar
  if (!primary && menuItems.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <primary.icon className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{primary.label}</span>
          </button>
        )}
        {menuItems.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={pending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50"
              aria-label="Más acciones"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                {menuItems.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={item.onClick}
                    disabled={pending}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                      item.danger ? "text-destructive" : ""
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {reasonOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!pending) {
              setReasonOpen(null);
              setReason("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">
                {reasonOpen === "reject" ? "Motivo del rechazo" : "Motivo de la cancelación"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {reasonOpen === "reject"
                  ? "Explica brevemente por qué rechazas este cobro."
                  : "Explica por qué se cancela (cliente no paga, error de registro…)."}
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                autoFocus
                placeholder={
                  reasonOpen === "reject"
                    ? "Importe incorrecto, justificante ilegible…"
                    : "El cliente nunca pasó por la oficina…"
                }
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => {
                  setReasonOpen(null);
                  setReason("");
                }}
                disabled={pending}
              >
                <ArrowLeft className="h-3 w-3" /> Volver
              </Button>
              <Button variant="destructive" onClick={confirmReason} disabled={pending}>
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}

      {methodOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setMethodOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">Cambiar método de cobro</h2>
              <p className="text-xs text-muted-foreground">
                {isPending
                  ? "El cobro está pendiente — puedes cambiar el método antes de confirmarlo."
                  : "El cobro ya está registrado. Cambiar el método queda en el log de auditoría."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {METHOD_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setNewMethod(m.value)}
                    className={`rounded-xl border-2 p-3 text-sm font-bold ${
                      newMethod === m.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setMethodOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={changeMethod} disabled={pending} variant="success">
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
