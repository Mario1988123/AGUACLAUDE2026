import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmailDetail } from "@/modules/mailing/dashboard-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ResendButton } from "@/modules/mailing/resend-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  bounced: "Rebotado",
  complained: "Spam",
  failed: "Fallido",
};
const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  queued: "secondary",
  sending: "secondary",
  sent: "outline",
  delivered: "success",
  bounced: "destructive",
  complained: "destructive",
  failed: "destructive",
};

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES");
}

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const email = await getEmailDetail(id);
  if (!email) notFound();

  const trackingEvents: Array<{ label: string; date: string | null; tone?: "success" | "warning" | "error" }> = [
    { label: "Creado", date: email.created_at },
    { label: "Enviado", date: email.sent_at },
    { label: "Entregado", date: email.delivered_at, tone: "success" },
    { label: "Abierto", date: email.opened_at, tone: "success" },
    { label: "Pulsó enlace", date: email.clicked_at, tone: "success" },
    { label: "Rebotado", date: email.bounced_at, tone: "error" },
    { label: "Spam", date: email.complained_at, tone: "error" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/mailing"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Volver a mailing
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{email.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Para <strong>{email.customer_name ?? email.to_name ?? "—"}</strong> &lt;{email.to_email}&gt;
            {email.user_name && (
              <>
                {" · "}por <strong>{email.user_name}</strong>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={STATUS_VARIANT[email.status] ?? "outline"}>
            {STATUS_LABEL[email.status] ?? email.status}
          </Badge>
          <Badge variant={email.kind === "marketing" ? "secondary" : "outline"}>
            {email.kind === "marketing" ? "Marketing" : "Transaccional"}
          </Badge>
          <ResendButton emailId={email.id} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cuerpo del email</CardTitle>
          </CardHeader>
          <CardContent>
            {email.body_html ? (
              <iframe
                title="Cuerpo email"
                srcDoc={email.body_html}
                className="h-[600px] w-full rounded-md border bg-white"
                sandbox="allow-same-origin"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Cuerpo no disponible (purgado por retención RGPD a los 6 meses).
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="De" value={`${email.from_name ?? ""} <${email.from_email}>`.trim()} />
              <Row label="Plantilla" value={email.template_key ?? "—"} />
              <Row label="Resend ID" value={email.resend_id ?? "—"} />
              <Row label="Aperturas" value={String(email.opens_count ?? 0)} />
              <Row label="Clics" value={String(email.clicks_count ?? 0)} />
              {email.attachments_meta && email.attachments_meta.length > 0 && (
                <Row
                  label="Adjuntos"
                  value={email.attachments_meta.map((a) => a.name).join(", ")}
                />
              )}
              {email.error_message && (
                <Row label="Error" value={email.error_message} tone="error" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {trackingEvents.map((e) => (
                  <li
                    key={e.label}
                    className={`flex items-center justify-between gap-2 ${
                      e.date ? "" : "opacity-40"
                    }`}
                  >
                    <span
                      className={
                        e.tone === "success"
                          ? "text-emerald-700 font-bold"
                          : e.tone === "error"
                            ? "text-rose-700 font-bold"
                            : ""
                      }
                    >
                      {e.label}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {fmtDateTime(e.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {email.related_subject_type && email.related_subject_id && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vinculado a</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/${email.related_subject_type === "customer" ? "clientes" : email.related_subject_type === "contract" ? "contratos" : email.related_subject_type === "proposal" ? "propuestas" : email.related_subject_type === "installation" ? "instalaciones" : email.related_subject_type === "incident" ? "incidencias" : ""}/${email.related_subject_id}` as never}
                  className="text-sm font-bold text-primary hover:underline"
                >
                  Ver {email.related_subject_type} →
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "error";
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div
        className={`col-span-2 break-words font-medium ${
          tone === "error" ? "text-rose-700" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
