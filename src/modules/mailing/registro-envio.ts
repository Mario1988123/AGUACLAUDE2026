/**
 * Campos de `email_sends` que dependen del resultado de `sendViaSmtp`.
 * Puro (sin "server-only") para poder probarlo con vitest.
 *
 * Lo importante es `resend_id`: sin él, el webhook de Resend no puede casar
 * los eventos (entregado, abierto, rebotado…) con la fila.
 */

export type ResultadoEnvio =
  | {
      ok: true;
      accountType: string;
      resend_id?: string | null;
      fromEmail?: string;
      fromName?: string;
    }
  | { ok: false; error: string };

export function camposResultadoEnvio(
  res: ResultadoEnvio,
  ahora: Date = new Date(),
): {
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string | null;
  from_account_type: string | null;
  resend_id: string | null;
} {
  if (res.ok) {
    return {
      status: "sent",
      error_message: null,
      sent_at: ahora.toISOString(),
      from_account_type: res.accountType,
      resend_id: res.resend_id ?? null,
    };
  }
  return {
    status: "failed",
    error_message: res.error,
    sent_at: null,
    from_account_type: null,
    resend_id: null,
  };
}
