"use client";

import { useEffect, useState, useTransition } from "react";
import { Mail, Save, Send, BookOpen, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Badge } from "@/shared/ui/badge";
import { EmailProviderGuide, type SmtpPreset, detectProviderFromEmail } from "./provider-guide";
import {
  setUserSmtpAction,
  testSmtpAction,
  getUserSmtpAction,
} from "./user-smtp-actions";

interface Props {
  userId: string;
  userEmail: string;
  userFullName?: string | null;
}

/**
 * Botón "SMTP" para configurar el correo de un usuario.
 * Lo usa el admin desde /configuracion/usuarios (en row-actions),
 * y también puede usarlo cada usuario para su propio SMTP desde su perfil.
 */
export function UserSmtpDialogButton({ userId, userEmail, userFullName }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Configurar SMTP de este usuario"
          title="Configurar SMTP"
        >
          <Mail className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>SMTP de {userFullName ?? userEmail}</DialogTitle>
          <DialogDescription>
            Configura el SMTP propio de este usuario. Si lo dejas vacío, sus
            envíos saldrán desde el SMTP de la empresa.
          </DialogDescription>
        </DialogHeader>
        {open && <UserSmtpForm userId={userId} defaultFromEmail={userEmail} />}
      </DialogContent>
    </Dialog>
  );
}

function UserSmtpForm({
  userId,
  defaultFromEmail,
}: {
  userId: string;
  defaultFromEmail: string;
}) {
  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [fromEmail, setFromEmail] = useState(defaultFromEmail);
  const [fromName, setFromName] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  useEffect(() => {
    getUserSmtpAction(userId).then((cur) => {
      if (cur) {
        setHost(cur.smtp_host ?? "");
        setPort(cur.smtp_port?.toString() ?? "587");
        setUser(cur.smtp_user ?? "");
        setSecure(cur.smtp_secure ?? true);
        setFromEmail(cur.from_email ?? defaultFromEmail);
        setFromName(cur.from_name ?? "");
        setProvider(cur.smtp_provider ?? null);
        setHasStoredPassword(cur.has_password);
      }
      setLoading(false);
    });
  }, [userId, defaultFromEmail]);

  const detectedProvider = detectProviderFromEmail(user || fromEmail);

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
      const r = await setUserSmtpAction({
        user_id: userId,
        smtp_host: host.trim(),
        smtp_port: parseInt(port) || 587,
        smtp_user: user.trim(),
        smtp_password: password || undefined,
        smtp_secure: secure,
        from_email: fromEmail.trim(),
        from_name: fromName.trim() || undefined,
        smtp_provider: provider ?? undefined,
      });
      setResult(
        r.ok
          ? { ok: true, message: "Configuración guardada" }
          : { ok: false, message: r.error },
      );
      if (r.ok && password) setHasStoredPassword(true);
      if (r.ok) setPassword("");
    });
  }

  function test() {
    setResult(null);
    startTest(async () => {
      const r = await testSmtpAction({
        scope: "user",
        user_id: userId,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Dialog open={showGuide} onOpenChange={setShowGuide}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" type="button" className="gap-2">
              <BookOpen className="h-4 w-4" />
              Elegir proveedor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Elige el proveedor de email del usuario</DialogTitle>
            </DialogHeader>
            <EmailProviderGuide
              detectEmail={user || fromEmail}
              onApply={applyPreset}
            />
          </DialogContent>
        </Dialog>
        {detectedProvider && (
          <Badge variant="outline" className="gap-1 text-xs">
            <span>{detectedProvider.emoji}</span>
            {detectedProvider.name.split(" ")[0]}
          </Badge>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Email remitente</Label>
        <Input
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="comercial@miempresa.com"
        />
        <p className="text-xs text-muted-foreground">
          Email que aparecerá como remitente cuando este usuario envíe correos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Usuario SMTP</Label>
          <Input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="usuario@gmail.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contraseña SMTP</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              hasStoredPassword
                ? "•••••••• (guardada — deja vacío para mantenerla)"
                : "App password / contraseña SMTP"
            }
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={secure} onCheckedChange={setSecure} />
        <Label>Conexión segura (TLS/SSL)</Label>
      </div>

      <div className="rounded bg-yellow-50 p-2 text-xs text-muted-foreground">
        Si dejas SMTP vacío, este usuario enviará desde el SMTP de la empresa.
        Para Gmail/Workspace/iCloud/Yahoo es obligatorio usar una{" "}
        <strong>contraseña de aplicación</strong> (ver &quot;Elegir proveedor&quot;).
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
