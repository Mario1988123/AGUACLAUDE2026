"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { Copy, Check, KeyRound, UserPlus } from "lucide-react";
import {
  createCompanyAdminAction,
  resetCompanyAdminPassword,
  type CompanyAdminInfo,
} from "./actions";

interface Props {
  companyId: string;
  admin: CompanyAdminInfo | null;
}

export function CompanyAdminPanel({ companyId, admin }: Props) {
  const [pending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [form, setForm] = useState({ email: "", full_name: "" });

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await createCompanyAdminAction({
          company_id: companyId,
          email: form.email,
          full_name: form.full_name,
        });
        setCredentials({ email: result.email, password: result.temp_password });
        setShowCreate(false);
        setForm({ email: "", full_name: "" });
        notify.success("Administrador creado");
      } catch (err) {
        notify.error(
          "No se pudo crear",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  function handleReset() {
    if (!admin) return;
    if (!confirm(`¿Resetear contraseña de ${admin.email}? Se generará una nueva.`)) return;
    startTransition(async () => {
      try {
        const r = await resetCompanyAdminPassword(admin.user_id);
        setCredentials({ email: admin.email ?? "", password: r.temp_password });
        notify.success("Contraseña reseteada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (credentials) {
    return (
      <div className="space-y-3 rounded-md border border-warning bg-warning/10 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
          <KeyRound className="h-4 w-4" />
          Credenciales generadas — guárdalas ahora, no se volverán a mostrar
        </div>
        <CredField label="Email" value={credentials.email} field="email" {...{ copy, copiedField }} />
        <CredField
          label="Contraseña temporal"
          value={credentials.password}
          field="pwd"
          {...{ copy, copiedField }}
        />
        <p className="text-xs text-muted-foreground">
          El admin tendrá que cambiar la contraseña en su primer inicio de sesión.
        </p>
        <Button variant="outline" size="sm" onClick={() => setCredentials(null)}>
          Cerrar
        </Button>
      </div>
    );
  }

  if (admin) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{admin.full_name}</div>
            <div className="text-xs text-muted-foreground">{admin.email ?? "—"}</div>
          </div>
          <Badge variant={admin.status === "active" ? "success" : "warning"}>
            {admin.status === "active" ? "Activo" : admin.status}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {admin.last_login_at
            ? `Último acceso: ${new Date(admin.last_login_at).toLocaleString("es-ES")}`
            : "Aún no ha entrado"}
        </div>
        <Button variant="outline" size="sm" onClick={handleReset} disabled={pending}>
          <KeyRound className="h-4 w-4" /> Resetear contraseña
        </Button>
      </div>
    );
  }

  if (!showCreate) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Esta empresa aún no tiene administrador. Créalo para que pueda acceder al panel.
        </p>
        <Button onClick={() => setShowCreate(true)} disabled={pending}>
          <UserPlus className="h-4 w-4" /> Crear administrador
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleCreate} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="adm_email">Email *</Label>
        <Input
          id="adm_email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="admin@empresa.com"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="adm_name">Nombre completo *</Label>
        <Input
          id="adm_name"
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear y generar contraseña"}
        </Button>
      </div>
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
  field: string;
  copy: (v: string, f: string) => void;
  copiedField: string | null;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-sm" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => copy(value, field)}
          aria-label={`Copiar ${label}`}
        >
          {copiedField === field ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
