"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { inviteUserSafeAction } from "./actions";

interface Props {
  roleOptions: { value: string; label: string }[];
}

export function InviteUserForm({ roleOptions }: Props) {
  const [pending, startTransition] = useTransition();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<"email" | "pwd" | null>(null);

  function toggleRole(role: string) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function copy(text: string, field: "email" | "pwd") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      notify.warning("No se pudo copiar al portapapeles");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selectedRoles.length === 0) {
      notify.warning("Selecciona al menos un rol");
      return;
    }
    const fd = new FormData(e.currentTarget);
    selectedRoles.forEach((r) => fd.append("roles", r));
    const formEl = e.currentTarget;
    startTransition(async () => {
      const result = await inviteUserSafeAction(fd);
      if (!result.ok) {
        notify.error("No se pudo crear", result.error);
        return;
      }
      setCredentials({ email: result.email, password: result.temp_password });
      notify.success("Usuario creado");
      formEl.reset();
      setSelectedRoles([]);
    });
  }

  if (credentials) {
    return (
      <div className="space-y-3 rounded-md border-2 border-amber-300 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
          <KeyRound className="h-4 w-4" />
          Credenciales generadas — guárdalas ahora, no se volverán a mostrar
        </div>
        <p className="text-xs text-amber-800">
          Pásale estas credenciales al usuario. Al iniciar sesión por
          primera vez, el sistema le pedirá automáticamente que cambie la
          contraseña por una propia.
        </p>
        <CredField
          label="Email"
          value={credentials.email}
          field="email"
          copy={copy}
          copiedField={copiedField}
        />
        <CredField
          label="Contraseña temporal"
          value={credentials.password}
          field="pwd"
          copy={copy}
          copiedField={copiedField}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setCredentials(null)}>
            Crear otro usuario
          </Button>
        </div>
      </div>
    );
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
          Un usuario puede tener varios roles (ej. director comercial + comercial).
        </p>
      </div>
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <strong>Cómo funciona:</strong> al crear el usuario se generará una
        contraseña temporal de 16 caracteres. Cópiala y pásasela al usuario.
        En su primer login se le pedirá que la cambie por una propia.
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creando..." : "Crear usuario"}
      </Button>
    </form>
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
      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">{label}</div>
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
