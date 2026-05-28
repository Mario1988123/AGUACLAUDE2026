"use client";

import { useState, useTransition } from "react";
import { Save, Send, CheckCircle, XCircle, Loader2, BookOpen } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { EmailProviderGuide, type SmtpPreset } from "./provider-guide";
import {
  setCompanySmtpAction,
  testSmtpAction,
  type SmtpConfigSummary,
  type SmtpScope,
} from "./actions";

interface Props {
  scope: SmtpScope;
  initial?: SmtpConfigSummary;
}

const EMPTY: SmtpConfigSummary = {
  configured: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_secure: true,
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_provider: null,
  smtp_updated_at: null,
};

export function CompanySmtpForm({ scope, initial }: Props) {
  const init = initial ?? EMPTY;
  const [host, setHost] = useState(init.smtp_host);
  const [port, setPort] = useState(init.smtp_port.toString());
  const [user, setUser] = useState(init.smtp_user);
  const [password, setPassword] = useState(""); // siempre vacío al cargar
  const [secure, setSecure] = useState(init.smtp_secure);
  const [fromEmail, setFromEmail] = useState(init.smtp_from_email);
  const [fromName, setFromName] = useState(init.smtp_from_name);
  const [provider, setProvider] = useState<string | null>(init.smtp_provider);
  const [showGuide, setShowGuide] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const wasConfigured = init.configured;

  function applyPreset(p: SmtpPreset & { providerId: string; providerName: string }) {
    setHost(p.host);
    setPort(p.port.toString());
    setSecure(p.secure);
    setProvider(p.providerId);
    setShowGuide(false);
  }

  function save() {
    setResult(null);
    startSave(async () => {
      const r = await setCompanySmtpAction(scope, {
        smtp_host: host.trim(),
        smtp_port: parseInt(port) || 587,
        smtp_user: user.trim(),
        smtp_password: password || undefined,
        smtp_secure: secure,
        smtp_from_email: fromEmail.trim(),
        smtp_from_name: fromName.trim() || undefined,
        smtp_provider: provider ?? undefined,
      });
      setResult(
        r.ok
          ? { ok: true, message: "Configuración guardada" }
          : { ok: false, message: r.error },
      );
      if (r.ok) setPassword(""); // limpiar input password tras guardar
    });
  }

  function test() {
    setResult(null);
    startTest(async () => {
      const r = await testSmtpAction({
        scope,
        smtp_host: host.trim(),
        smtp_port: parseInt(port) || 587,
        smtp_user: user.trim(),
        smtp_password: password || undefined,
        smtp_secure: secure,
      });
      setResult(
        r.ok
          ? { ok: true, message: "Conexión exitosa" }
          : { ok: false, message: r.error },
      );
    });
  }

  return (
    <div className="space-y-4">
      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" type="button" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Elegir mi proveedor
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Elige tu proveedor de email</DialogTitle>
          </DialogHeader>
          <EmailProviderGuide detectEmail={user} onApply={applyPreset} />
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Servidor SMTP</Label>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.gmail.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Puerto</Label>
          <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Usuario SMTP</Label>
          <Input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="tu@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contraseña</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              wasConfigured
                ? "•••••••• (guardada — deja vacío para mantenerla)"
                : "Tu contraseña SMTP o app password"
            }
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Email remitente</Label>
          <Input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="noreply@tuempresa.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Nombre remitente</Label>
          <Input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Tu Empresa"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={secure} onCheckedChange={setSecure} />
        <Label>Conexión segura (TLS/SSL)</Label>
      </div>

      {result && (
        <div
          className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
            result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {result.ok ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {result.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || !host || !user}
          className="gap-2"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Probar conexión
        </Button>
      </div>
    </div>
  );
}
