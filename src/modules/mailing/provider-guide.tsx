"use client";

import { useState } from "react";
import { ExternalLink, Search, AlertCircle, Check } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

export interface SmtpPreset {
  host: string;
  port: number;
  secure: boolean;
}

export interface EmailProvider {
  id: string;
  name: string;
  category: "google" | "microsoft" | "apple" | "european" | "transactional" | "other";
  emoji: string;
  domains: string[];
  smtp: SmtpPreset;
  userHint: string;
  passwordHint: string;
  steps: string[];
  warnings?: string[];
  docUrl?: string;
}

export const EMAIL_PROVIDERS: EmailProvider[] = [
  {
    id: "gmail",
    name: "Gmail (cuenta @gmail.com)",
    category: "google",
    emoji: "📧",
    domains: ["gmail.com", "googlemail.com"],
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    userHint: "Tu dirección completa: tucuenta@gmail.com",
    passwordHint: "Contraseña de aplicación (16 caracteres) — NO tu contraseña normal",
    steps: [
      "Activa la verificación en 2 pasos en myaccount.google.com/security",
      "Crea una contraseña de aplicación en myaccount.google.com/apppasswords",
      "Asigna un nombre descriptivo (\"AguaClaude CRM\") y copia los 16 caracteres",
      "Pulsa \"Usar esta configuración\" y pega los 16 caracteres como contraseña",
      "El email remitente debe ser tu misma dirección de Gmail",
    ],
    warnings: [
      "Sin verificación en 2 pasos no podrás crear contraseña de aplicación",
      "Gmail reescribe el \"From\" si pones una dirección distinta — usa siempre tu cuenta real",
      "Límite gratuito ~500 destinatarios/día. Para más volumen usa Workspace",
    ],
    docUrl: "https://support.google.com/mail/answer/185833",
  },
  {
    id: "google-workspace",
    name: "Google Workspace (dominio propio)",
    category: "google",
    emoji: "🏢",
    domains: [],
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    userHint: "Tu email Workspace: usuario@tudominio.com",
    passwordHint: "Contraseña de aplicación (16 caracteres)",
    steps: [
      "Activa la verificación en 2 pasos en la cuenta",
      "Crea una contraseña de aplicación en myaccount.google.com/apppasswords",
      "Pulsa \"Usar esta configuración\" y pega los 16 caracteres",
      "Activa DKIM en Google Admin → Apps → Gmail → Autenticar email (mejora deliverability)",
    ],
    warnings: [
      "Si tu dominio sigue apuntando a otro proveedor, configura MX hacia Google primero",
      "Alternativa avanzada: smtp-relay.gmail.com con IP autorizada (sin app password)",
    ],
    docUrl: "https://support.google.com/a/answer/176600",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    category: "microsoft",
    emoji: "📨",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    userHint: "Tu email completo: usuario@outlook.com o usuario@tudominio.com",
    passwordHint: "Contraseña de aplicación si tienes 2FA; si no, tu contraseña normal",
    steps: [
      "Si tienes 2FA: account.microsoft.com → Seguridad → Opciones avanzadas → Contraseñas de aplicación",
      "Crea una nueva contraseña de aplicación y cópiala",
      "Pulsa \"Usar esta configuración\"",
      "Mete tu email completo como usuario",
      "Pega la contraseña de aplicación (o la normal si no tienes 2FA)",
    ],
    warnings: [
      "Microsoft está deshabilitando SMTP AUTH básico en muchos tenants — si falla, pide al admin de M365 que lo habilite en Exchange Admin Center",
    ],
    docUrl:
      "https://support.microsoft.com/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040",
  },
  {
    id: "icloud",
    name: "Apple iCloud Mail",
    category: "apple",
    emoji: "🍎",
    domains: ["icloud.com", "me.com", "mac.com"],
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    userHint: "Tu Apple ID: usuario@icloud.com",
    passwordHint: "Contraseña específica de app (NO tu contraseña Apple ID)",
    steps: [
      "Entra en appleid.apple.com → Inicia sesión",
      "Sección \"Seguridad\" → \"Contraseñas específicas de app\" → Generar contraseña",
      "Asigna un nombre (\"AguaClaude CRM\") y copia los caracteres generados",
      "Pulsa \"Usar esta configuración\" y pega esa contraseña",
    ],
    warnings: [
      "Requiere autenticación de doble factor activada en el Apple ID",
      "Apple solo permite enviar desde tu dirección @icloud.com / @me.com / @mac.com",
    ],
    docUrl: "https://support.apple.com/HT202304",
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    category: "other",
    emoji: "💜",
    domains: ["yahoo.com", "yahoo.es", "ymail.com"],
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    userHint: "Tu email: usuario@yahoo.com",
    passwordHint: "Contraseña de aplicación",
    steps: [
      "Activa la verificación en 2 pasos en login.yahoo.com/account/security",
      "En la misma página → \"Generar y administrar contraseñas de aplicación\"",
      "Crea una nueva y cópiala",
      "Pulsa \"Usar esta configuración\" y pega la contraseña",
    ],
    warnings: ["Sin 2FA no se puede crear contraseña de aplicación"],
    docUrl: "https://help.yahoo.com/kb/SLN15241.html",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    category: "other",
    emoji: "🟢",
    domains: ["zoho.com", "zoho.eu"],
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
    userHint: "Tu email Zoho: usuario@zoho.eu",
    passwordHint: "Contraseña de aplicación si tienes 2FA; si no, la de tu cuenta",
    steps: [
      "Comprueba si tu cuenta está en la región EU (.eu) o US (.com)",
      "Si 2FA: accounts.zoho.eu → Seguridad → Contraseñas específicas de app → Generar nueva",
      "Pulsa \"Usar esta configuración\" — si tu cuenta es US cambia el host a smtp.zoho.com",
      "Mete usuario y contraseña",
    ],
    warnings: ["Comprueba la región (smtp.zoho.com vs smtp.zoho.eu) o fallará el login"],
    docUrl: "https://www.zoho.com/mail/help/zoho-smtp.html",
  },
  {
    id: "ionos",
    name: "IONOS (1&1)",
    category: "european",
    emoji: "🟧",
    domains: [],
    smtp: { host: "smtp.ionos.es", port: 587, secure: false },
    userHint: "Tu email IONOS: usuario@tudominio.com",
    passwordHint: "La contraseña del buzón (sin trucos)",
    steps: [
      "En el panel IONOS asegúrate de que el buzón existe y tiene contraseña asignada",
      "Pulsa \"Usar esta configuración\"",
      "Mete el email completo y su contraseña",
    ],
    warnings: ["Si IONOS rechaza, prueba el puerto 465 con SSL activado"],
    docUrl: "https://www.ionos.es/ayuda/email/configuracion-general/datos-de-configuracion-imap-y-smtp/",
  },
  {
    id: "hostinger",
    name: "Hostinger",
    category: "european",
    emoji: "🟪",
    domains: [],
    smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
    userHint: "Tu email Hostinger: usuario@tudominio.com",
    passwordHint: "La contraseña del buzón",
    steps: [
      "En hPanel → Correos → asegúrate de que el buzón existe",
      "Si el dominio está en Hostinger, los registros MX/SPF se crean automáticamente",
      "Activa DKIM en hPanel → Correos → Configuración del email",
      "Pulsa \"Usar esta configuración\" y mete email + contraseña",
    ],
    warnings: ["Sin DKIM/SPF los correos pueden ir a spam"],
    docUrl: "https://support.hostinger.com/es/articles/1583453",
  },
  {
    id: "ovh",
    name: "OVH",
    category: "european",
    emoji: "🟦",
    domains: [],
    smtp: { host: "ssl0.ovh.net", port: 465, secure: true },
    userHint: "Tu email OVH: usuario@tudominio.com",
    passwordHint: "La contraseña del buzón",
    steps: [
      "En el panel OVH → Correos → asegúrate del buzón y la contraseña",
      "Pulsa \"Usar esta configuración\"",
      "Mete email completo y contraseña",
    ],
    docUrl: "https://help.ovhcloud.com/csm/es-mx-emails-pro-clients-smtp-imap-pop-settings",
  },
  {
    id: "brevo",
    name: "Brevo (ex-Sendinblue)",
    category: "transactional",
    emoji: "🐝",
    domains: [],
    smtp: { host: "smtp-relay.brevo.com", port: 587, secure: false },
    userHint: "Tu login de Brevo (email de la cuenta)",
    passwordHint: "SMTP key (no la contraseña de tu cuenta)",
    steps: [
      "Entra en app.brevo.com → Settings → SMTP & API → SMTP",
      "Genera una nueva clave SMTP",
      "Pulsa \"Usar esta configuración\"",
      "Usuario: tu email de Brevo. Contraseña: la SMTP key",
    ],
    warnings: ["Verifica el dominio remitente en Brevo o los correos irán a spam"],
    docUrl: "https://help.brevo.com/hc/articles/209462765",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    category: "transactional",
    emoji: "📬",
    domains: [],
    smtp: { host: "smtp.sendgrid.net", port: 587, secure: false },
    userHint: "Literal: apikey",
    passwordHint: "API key generada en sendgrid.com",
    steps: [
      "Crea cuenta en sendgrid.com y verifica el dominio remitente",
      "En Settings → API Keys → Crear nueva con permiso \"Mail Send\"",
      "Pulsa \"Usar esta configuración\"",
      "Usuario: apikey (literal). Contraseña: la API key",
    ],
    docUrl: "https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api",
  },
  {
    id: "mailjet",
    name: "Mailjet",
    category: "transactional",
    emoji: "✉️",
    domains: [],
    smtp: { host: "in-v3.mailjet.com", port: 587, secure: false },
    userHint: "API key de Mailjet (no tu email)",
    passwordHint: "Secret key de Mailjet",
    steps: [
      "Crea cuenta en mailjet.com",
      "Account Settings → SMTP and SEND API Settings → genera API key + secret",
      "Pulsa \"Usar esta configuración\"",
      "Usuario: API key. Contraseña: Secret key",
    ],
    docUrl: "https://dev.mailjet.com/smtp-relay/configuration/",
  },
  {
    id: "mailgun",
    name: "Mailgun",
    category: "transactional",
    emoji: "🔫",
    domains: [],
    smtp: { host: "smtp.mailgun.org", port: 587, secure: false },
    userHint: "postmaster@tudominio.mailgun.org",
    passwordHint: "Password SMTP (no tu contraseña de cuenta)",
    steps: [
      "En Mailgun.com → añade y verifica tu dominio",
      "Sending → Domain settings → SMTP credentials → copia el password",
      "Pulsa \"Usar esta configuración\"",
    ],
    docUrl: "https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/",
  },
  {
    id: "postmark",
    name: "Postmark",
    category: "transactional",
    emoji: "🟫",
    domains: [],
    smtp: { host: "smtp.postmarkapp.com", port: 587, secure: false },
    userHint: "Server Token de Postmark",
    passwordHint: "El mismo Server Token (se usa como user y password)",
    steps: [
      "Crea cuenta en postmarkapp.com y verifica dominio",
      "Servers → tu server → API Tokens → copia el Server Token",
      "Pulsa \"Usar esta configuración\"",
      "Usuario y contraseña: el mismo token",
    ],
    docUrl: "https://postmarkapp.com/developer/user-guide/send-email-with-smtp",
  },
  {
    id: "custom",
    name: "Otro / personalizado",
    category: "other",
    emoji: "⚙️",
    domains: [],
    smtp: { host: "", port: 587, secure: false },
    userHint: "El que indique tu proveedor de correo",
    passwordHint: "El que indique tu proveedor",
    steps: [
      "Consulta a tu proveedor de correo los datos SMTP (host, puerto, SSL/TLS)",
      "Rellena el formulario manualmente",
      "Pulsa \"Probar Conexión\" para verificar",
    ],
  },
];

interface Props {
  onApply: (preset: SmtpPreset & { providerId: string; providerName: string }) => void;
  detectEmail?: string;
}

export function EmailProviderGuide({ onApply, detectEmail }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const detectedDomain = detectEmail?.split("@")[1]?.toLowerCase();
  const detectedProvider = detectedDomain
    ? EMAIL_PROVIDERS.find((p) => p.domains.includes(detectedDomain))
    : null;

  const filtered = search
    ? EMAIL_PROVIDERS.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.smtp.host.includes(search.toLowerCase()),
      )
    : EMAIL_PROVIDERS;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar proveedor (gmail, ionos, hostinger…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {detectedProvider && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-3 text-sm">
          <p className="font-medium text-blue-900 flex items-center gap-2">
            <Check className="h-4 w-4" />
            Detectado: {detectedProvider.name}
          </p>
          <p className="mt-1 text-blue-800">
            Tu email es <code className="rounded bg-blue-100 px-1">@{detectedDomain}</code> — pulsa la tarjeta correspondiente.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((provider) => {
          const isExpanded = expanded === provider.id;
          return (
            <Card
              key={provider.id}
              className={`cursor-pointer transition-colors ${
                isExpanded ? "border-primary" : "hover:border-muted-foreground/40"
              }`}
              onClick={() => setExpanded(isExpanded ? null : provider.id)}
            >
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{provider.emoji}</span>
                    <div>
                      <p className="font-medium leading-tight">{provider.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {provider.smtp.host || "—"}
                        {provider.smtp.host ? `:${provider.smtp.port}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="whitespace-nowrap text-xs">
                    {provider.category === "google" && "Google"}
                    {provider.category === "microsoft" && "Microsoft"}
                    {provider.category === "apple" && "Apple"}
                    {provider.category === "european" && "Europa"}
                    {provider.category === "transactional" && "API"}
                    {provider.category === "other" && "Otro"}
                  </Badge>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t pt-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">USUARIO</p>
                      <p className="text-xs">{provider.userHint}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">CONTRASEÑA</p>
                      <p className="text-xs">{provider.passwordHint}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">PASOS</p>
                      <ol className="list-inside list-decimal space-y-1 text-xs">
                        {provider.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                    {provider.warnings && provider.warnings.length > 0 && (
                      <div className="space-y-1 rounded border border-yellow-200 bg-yellow-50 p-2">
                        {provider.warnings.map((w, i) => (
                          <p key={i} className="flex items-start gap-1 text-xs text-yellow-900">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{w}</span>
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApply({
                            ...provider.smtp,
                            providerId: provider.id,
                            providerName: provider.name,
                          });
                        }}
                        className="w-full"
                        disabled={!provider.smtp.host}
                      >
                        Usar esta configuración
                      </Button>
                      {provider.docUrl && (
                        <a
                          href={provider.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center gap-1 text-xs text-primary hover:underline"
                        >
                          Documentación oficial <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function detectProviderFromEmail(email: string | null | undefined): EmailProvider | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  return EMAIL_PROVIDERS.find((p) => p.domains.includes(domain)) || null;
}
