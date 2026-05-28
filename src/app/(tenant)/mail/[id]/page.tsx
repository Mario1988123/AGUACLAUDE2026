import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { getMailDetail } from "@/modules/mail/actions";

export const dynamic = "force-dynamic";

export default async function MailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let email: Awaited<ReturnType<typeof getMailDetail>>;
  try {
    email = await getMailDetail(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/mail"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver al histórico
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{email.subject}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Para <strong>{email.to_name ?? email.to_email}</strong> &lt;{email.to_email}&gt;
            {" · "}desde{" "}
            <strong>
              {email.from_name ?? email.from_email} &lt;{email.from_email}&gt;
            </strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={email.status === "sent" ? "default" : "destructive"}>
            {email.status}
          </Badge>
          {email.send_type && <Badge variant="outline">{email.send_type}</Badge>}
          {email.trigger_event && (
            <Badge variant="outline" className="text-xs">
              {email.trigger_event}
            </Badge>
          )}
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
                Cuerpo no disponible (purgado por retención RGPD).
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
              <Row label="Plantilla" value={email.template_key ?? "—"} />
              <Row label="Cuenta SMTP" value={email.from_account_type ?? "—"} />
              <Row
                label="Creado"
                value={new Date(email.created_at).toLocaleString("es-ES")}
              />
              <Row
                label="Enviado"
                value={
                  email.sent_at
                    ? new Date(email.sent_at).toLocaleString("es-ES")
                    : "—"
                }
              />
              {email.error_message && (
                <Row label="Error" value={email.error_message} tone="error" />
              )}
            </CardContent>
          </Card>

          {(email.lead_id || email.customer_id || email.related_subject_type) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Relacionado con</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {email.lead_id && (
                  <Link href={`/leads/${email.lead_id}`}>
                    <Button variant="outline" size="sm" className="w-full">
                      Ver lead
                    </Button>
                  </Link>
                )}
                {email.customer_id && (
                  <Link href={`/clientes/${email.customer_id}`}>
                    <Button variant="outline" size="sm" className="w-full">
                      Ver cliente
                    </Button>
                  </Link>
                )}
                {email.related_subject_type && email.related_subject_id && (
                  <p className="text-xs text-muted-foreground">
                    {email.related_subject_type} · {email.related_subject_id}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "error" }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`text-right ${tone === "error" ? "text-red-700" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
