"use client";

import { useState, useTransition } from "react";
import { Pencil, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { setUserStatus, updateUserRoles } from "./actions";
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
}: {
  userId: string;
  currentRoles: string[];
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>(currentRoles);

  function toggleRole(r: string) {
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateUserRoles(userId, roles as RoleKey[]);
        notify.success("Roles actualizados");
        setOpen(false);
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function suspend() {
    if (!confirm("¿Suspender este usuario?")) return;
    startTransition(async () => {
      try {
        await setUserStatus(userId, "suspended");
        notify.success("Usuario suspendido");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reactivate() {
    startTransition(async () => {
      try {
        await setUserStatus(userId, "active");
        notify.success("Usuario reactivado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <UserPermissionsButton userId={userId} />
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Editar roles">
          <Pencil className="h-4 w-4" />
        </Button>
        {status === "suspended" ? (
          <Button size="sm" variant="ghost" onClick={reactivate} disabled={pending}>
            <RotateCcw className="h-4 w-4 text-success" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={suspend} disabled={pending}>
            <Ban className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
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
