"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { inviteUserAction } from "./actions";

interface Props {
  roleOptions: { value: string; label: string }[];
}

export function InviteUserForm({ roleOptions }: Props) {
  const [pending, startTransition] = useTransition();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selectedRoles.length === 0) {
      notify.warning("Selecciona al menos un rol");
      return;
    }
    const fd = new FormData(e.currentTarget);
    selectedRoles.forEach((r) => fd.append("roles", r));
    startTransition(async () => {
      try {
        await inviteUserAction(fd);
        notify.success("Invitación enviada");
        (e.target as HTMLFormElement).reset();
        setSelectedRoles([]);
      } catch (err) {
        notify.error("No se pudo invitar", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email *</Label>
        <Input id="email" name="email" type="email" required placeholder="usuario@empresa.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="full_name">Nombre completo *</Label>
        <Input id="full_name" name="full_name" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" type="tel" placeholder="+34 600 000 000" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="job_title">Cargo</Label>
          <Input id="job_title" name="job_title" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Roles *</Label>
        <div className="space-y-1">
          {roleOptions.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selectedRoles.includes(r.value)}
                onChange={() => toggleRole(r.value)}
                className="h-4 w-4 rounded border-input"
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Decisión 1.2: un usuario puede tener varios roles (ej. director comercial + comercial).
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando..." : "Enviar invitación"}
      </Button>
    </form>
  );
}
