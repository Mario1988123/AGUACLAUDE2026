import Link from "next/link";
import { AlertCircle, Clock, RefreshCw } from "lucide-react";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { RetryFailedButton } from "./retry-button";

export interface QueueItem {
  id: string;
  record_id: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  attempt_number: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export async function getVerifactuQueue(): Promise<{
  pending: QueueItem[];
  failed: QueueItem[];
}> {
  const session = await requireSession();
  if (!session.company_id) return { pending: [], failed: [] };
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin")
  ) {
    return { pending: [], failed: [] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: subs } = await supabase
    .from("invoice_aeat_submissions")
    .select(
      "id, record_id, status, attempt_number, error_code, error_message, created_at",
    )
    .eq("company_id", session.company_id)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(50);
  type S = {
    id: string;
    record_id: string;
    status: string;
    attempt_number: number;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  };
  const list = (subs ?? []) as S[];
  if (list.length === 0) return { pending: [], failed: [] };

  const recordIds = Array.from(new Set(list.map((s) => s.record_id)));
  const { data: records } = await supabase
    .from("invoice_verifactu_records")
    .select("id, invoice_id, series_code, invoice_number")
    .in("id", recordIds);
  const recMap = new Map(
    ((records ?? []) as Array<{
      id: string;
      invoice_id: string;
      series_code: string;
      invoice_number: number;
    }>).map((r) => [
      r.id,
      {
        invoice_id: r.invoice_id,
        invoice_number: `${r.series_code}/${r.invoice_number}`,
      },
    ]),
  );

  const items: QueueItem[] = list.map((s) => {
    const rec = recMap.get(s.record_id);
    return {
      id: s.id,
      record_id: s.record_id,
      invoice_id: rec?.invoice_id ?? "",
      invoice_number: rec?.invoice_number ?? "?",
      status: s.status,
      attempt_number: s.attempt_number,
      error_code: s.error_code,
      error_message: s.error_message,
      created_at: s.created_at,
    };
  });
  return {
    pending: items.filter((i) => i.status === "pending"),
    failed: items.filter((i) => i.status === "failed"),
  };
}

export function VerifactuQueueCard({
  pending,
  failed,
}: {
  pending: QueueItem[];
  failed: QueueItem[];
}) {
  if (pending.length === 0 && failed.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            🛂 Cola Verifactu (envíos AEAT)
          </span>
          {failed.length > 0 && (
            <Badge variant="destructive">{failed.length} rechazadas</Badge>
          )}
          {pending.length > 0 && (
            <Badge variant="warning">{pending.length} pendientes</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-bold text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" /> Rechazadas por AEAT
            </h3>
            <ul className="space-y-2">
              {failed.map((it) => (
                <li
                  key={it.id}
                  className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-3"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/facturas/${it.invoice_id}` as never}
                        className="font-bold text-primary hover:underline"
                      >
                        {it.invoice_number}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Intento {it.attempt_number} ·{" "}
                        {new Date(it.created_at).toLocaleDateString("es-ES")}
                      </div>
                      {it.error_code && (
                        <div className="mt-1 text-xs">
                          <strong>Código:</strong> {it.error_code}
                        </div>
                      )}
                      {it.error_message && (
                        <div className="mt-1 text-xs text-destructive">
                          {it.error_message}
                        </div>
                      )}
                    </div>
                    <RetryFailedButton submissionId={it.id} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-bold flex items-center gap-1">
              <Clock className="h-4 w-4" /> Pendientes de envío
            </h3>
            <ul className="space-y-1">
              {pending.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between gap-2 rounded-xl border bg-card p-2 text-sm"
                >
                  <Link
                    href={`/facturas/${it.invoice_id}` as never}
                    className="font-bold text-primary hover:underline"
                  >
                    {it.invoice_number}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    Intento {it.attempt_number} ·{" "}
                    {new Date(it.created_at).toLocaleString("es-ES")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Se procesarán automáticamente
              en el próximo cron diario, o usa el botón «Reintentar» para
              forzar el envío individual.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
