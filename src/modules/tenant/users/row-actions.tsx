"use client";

import { useState, useTransition } from "react";
import { Pencil, Ban, RotateCcw, KeyRound, Trash2, Check, Copy } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  setUserStatusSafeAction,
  updateUserRolesSafeAction,
  resetUserPasswordSafeAction,
  deleteUserPermanentlySafeAction,
} from "./actions";
import { ROLE_KEYS, type RoleKey } from "./schemas";
import { UserPermissionsButton } from "./permissions-dialog";

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  technical_director: "Director técnico",
  commercial_director: "Director comercial",
  telemarketing_director: "Director TMK",
  installer: "Instalador",
  sales_rep: "Comercial",
  telemarketer: "Teleoperador",
};

export function UserRowActions({
  userId,
  currentRoles,
  status,
  fullName,
}: {
  userId: string;
  currentRoles: string[];
  status: string;
  fullName?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>(currentRoles);
  const [resetCreds, setResetCreds] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<"email" | "pwd" | null>(null);
  const ask = useConfirm();

  async function copy(text: string, field: "email" | "pwd") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      notify.warning("No se pudo copiar al portapapeles");
    }
  }

  async function resetPassword() {
    const ok = await ask({
      message: `¿Resetear la contraseña de ${fullName ?? "este usuario"}? Se generará una nueva temporal y se le pedirá cambiarla en su próximo login.`,
      confirmText: "Resetear",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await resetUserPasswordSafeAction(userId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setResetCreds({ email: r.email, password: r.temp_password });
      notify.success("Contraseña reseteada");
    });
  }

  async function deletePermanent() {
    const ok = await ask({
      message: `¿ELIMINAR PERMANENTEMENTE a ${fullName ?? "este usuario"}? Esta acción NO se puede deshacer. Sus contratos, instalaciones, leads y eventos se conservan pero quedarán sin usuario asignado. El email queda libre para reutilizar.`,
      confirmText: "Eliminar definitivo",
      variant: "destructive",
    });
    if (!ok) return;
    // Doble confirmación para acción destructiva
    const ok2 = await ask({
      message: "Confirmar otra vez: ¿estás SEGURO de que quieres eliminar al usuario y que no se pueda recuperar?",
      confirmText: "Sí, eliminar",
      variant: "destructive",
    });
    if (!ok2) return;
    startTransition(async () => {
      const r = await deleteUserPermanentlySafeAction(userId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Usuario eliminado permanentemente");
      location.reload();
    });
  }

  function toggleRole(r: string) {
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  }

  function save() {
    startTransition(async () => {
      const r = await updateUserRolesSafeAction(userId, roles as RoleKey[]);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Roles actualizados");
      setOpen(false);
      location.reload();
    });
  }

  async function suspend() {
    const ok = await ask({
      message: "¿Suspender este usuario?",
      confirmText: "Suspender",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await setUserStatusSafeAction(userId, "suspended");
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Usuario suspendido");
      location.reload();
    });
  }

  function reactivate() {
    startTransition(async () => {
      const r = await setUserStatusSafeAction(userId, "active");
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Usuario reactivado");
      location.reload();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <UserPermissionsButton userId={userId} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label="Editar roles"
          title="Editar roles"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={resetPassword}
          disabled={pending}
          aria-label="Resetear contraseña"
          title="Resetear contraseña"
        >
          <KeyRound className="h-4 w-4 text-amber-600" />
        </Button>
        {status === "suspended" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={reactivate}
            disabled={pending}
            aria-label="Reactivar"
            title="Reactivar"
          >
            <RotateCcw className="h-4 w-4 text-success" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={suspend}
            disabled={pending}
            aria-label="Suspender"
            title="Suspender (reversible)"
          >
            <Ban className="h-4 w-4 text-destructive" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={deletePermanent}
          disabled={pending}
          aria-label="Eliminar permanentemente"
          title="Eliminar permanentemente (libera el email)"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Modal con credenciales tras reset */}
      <Dialog open={Boolean(resetCreds)} onOpenChange={(o) => !o && setResetCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contraseña reseteada</DialogTitle>
          </DialogHeader>
          {resetCreds && (
            <div className="space-y-3 rounded-md border-2 border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <KeyRound className="h-4 w-4" />
                Guárdala ahora — no se volverá a mostrar
              </div>
              <p className="text-xs text-amber-800">
                Pásale estas credenciales al usuario. En su próximo inicio
                de sesión se le pedirá automáticamente cambiar la contraseña.
              </p>
              <CredField
                label="Email"
                value={resetCreds.email}
                field="email"
                copy={copy}
                copiedField={copiedField}
              />
              <CredField
                label="Contraseña temporal"
                value={resetCreds.password}
                field="pwd"
                copy={copy}
                copiedField={copiedField}
              />
              <div className="flex justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setResetCreds(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar roles</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Marca los roles que tendrá este usuario. Solo puede haber UN admin por empresa.
          </p>
          <div className="grid gap-2">
            {ROLE_KEYS.map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${
                  roles.includes(r) ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(r)}
                  onChange={() => toggleRole(r)}
                  className="h-5 w-5"
                />
                <span className="text-sm font-semibold">{ROLE_LABEL[r] ?? r}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CredField({
  label,
  value,
  field,
  copy,
  copiedField,
}: {
  label: string;
  value: string;
  field: "email" | "pwd";
  copy: (v: string, f: "email" | "pwd") => void;
  copiedField: "email" | "pwd" | null;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
        {label}
      </div>
      <div className="flex items-center gap-2 rounded border border-amber-300 bg-white px-2 py-1.5">
        <code className="flex-1 select-all break-all font-mono text-sm">{value}</code>
        <button
          type="button"
          onClick={() => copy(value, field)}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-amber-100"
          aria-label={`Copiar ${label}`}
        >
          {copiedField === field ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-amber-700" />
          )}
        </button>
      </div>
    </div>
  );
}
