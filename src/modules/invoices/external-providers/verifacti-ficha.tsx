"use client";

import { useTransition } from "react";
import { RefreshCw, Send, Ban } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  anularRegistroVerifactiAction,
  consultarEstadoVerifactiAction,
  pushInvoiceToExternalProviderAction,
  type EnvioExterno,
} from "./push-actions";

interface Props {
  invoiceId: string;
  invoiceStatus: string;
  invoiceKind: string;
  activo: boolean;
  entorno: "sandbox" | "production";
  envios: EnvioExterno[];
}

const ESTADOS_OK = new Set(["Correcto", "Aceptado con errores"]);
const ESTADOS_MAL = new Set(["Incorrecto", "Duplicado", "No registrado", "Factura inexistente"]);

function colorEstado(estado: string | null): string {
  if (!estado) return "font-bold";
  if (estado === "Correcto" || estado === "Anulado") return "font-bold text-emerald-700";
  if (ESTADOS_MAL.has(estado)) return "font-bold text-rose-700";
  return "font-bold text-amber-700";
}

/**
 * Bloque VeriFactu (Verifacti) en la ficha de factura: estado del registro
 * en la AEAT, último error y botones para registrar, consultar o anular.
 */
export function VerifactiFicha({
  invoiceId,
  invoiceStatus,
  invoiceKind,
  activo,
  entorno,
  envios,
}: Props) {
  const [pending, startTransition] = useTransition();

  const altas = envios.filter((e) => e.operacion === "alta");
  const altaViva = altas.find((e) => e.status === "sent" || e.status === "sending") ?? null;
  const ultimoFallo = altas[0]?.status === "failed" ? altas[0] : null;
  const anulacion = envios.find((e) => e.operacion === "anulacion" && e.status === "sent") ?? null;

  const emitida = ["issued", "paid", "overdue"].includes(invoiceStatus);
  const esFactura = invoiceKind === "invoice" || invoiceKind === "credit_note";
  const puedeRegistrar = activo && emitida && esFactura && !altaViva;
  const puedeAnular =
    activo && !!altaViva && altaViva.status === "sent" && ESTADOS_OK.has(altaViva.estado_aeat ?? "") && !anulacion;

  function registrar() {
    startTransition(async () => {
      const r = await pushInvoiceToExternalProviderAction(invoiceId);
      if (!r.ok) notify.error("No se registró en VeriFactu", r.error);
      else notify.success("VeriFactu", r.mensaje ?? "Factura enviada a Verifacti.");
    });
  }

  function consultar() {
    startTransition(async () => {
      const r = await consultarEstadoVerifactiAction(invoiceId);
      if (!r.ok) notify.error("No se pudo consultar", r.error);
      else notify.success("VeriFactu", r.mensaje);
    });
  }

  function anular() {
    const ok = window.confirm(
      "Vas a ANULAR el registro de esta factura en la AEAT.\n\n" +
        "Úsalo solo si la factura no debió emitirse nunca. Para corregir importes o datos, emite una rectificativa.\n\n" +
        "Una factura anulada no se puede volver a registrar con el mismo número y fecha. ¿Continuar?",
    );
    if (!ok) return;
    startTransition(async () => {
      const r = await anularRegistroVerifactiAction(invoiceId);
      if (!r.ok) notify.error("No se pudo anular", r.error);
      else notify.success("VeriFactu", r.mensaje);
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-muted-foreground">
        VeriFactu (Verifacti){entorno === "sandbox" ? " · entorno de PRUEBAS" : ""}
      </div>

      {!activo && (
        <p className="text-xs text-muted-foreground">
          El registro en VeriFactu no está activado. Se activa en Configuración → Facturación.
        </p>
      )}

      {altaViva ? (
        <div className="text-xs text-muted-foreground">
          Registro:{" "}
          <span className={colorEstado(altaViva.estado_aeat)}>
            {altaViva.status === "sending" ? "Enviando…" : (altaViva.estado_aeat ?? "Pendiente")}
          </span>
          {altaViva.sent_at && <> · {new Date(altaViva.sent_at).toLocaleString("es-ES")}</>}
          {(altaViva.codigo_error_aeat || altaViva.mensaje_error_aeat) && (
            <div className="mt-1 text-rose-700">
              AEAT: {altaViva.codigo_error_aeat} {altaViva.mensaje_error_aeat}
            </div>
          )}
          {altaViva.estado_aeat && ESTADOS_MAL.has(altaViva.estado_aeat) && (
            <div className="mt-1 text-rose-700">
              La AEAT no ha aceptado el registro. Corrígelo (subsanación) desde el panel de Verifacti o consulta con tu asesor.
            </div>
          )}
        </div>
      ) : (
        emitida &&
        esFactura &&
        activo && (
          <p className="text-xs font-bold text-amber-700">
            Esta factura no está registrada en VeriFactu.
          </p>
        )
      )}

      {anulacion && (
        <div className="text-xs text-muted-foreground">
          Anulación: <span className={colorEstado(anulacion.estado_aeat)}>{anulacion.estado_aeat ?? "Pendiente"}</span>
        </div>
      )}

      {!altaViva && ultimoFallo?.error_message && (
        <div className="text-xs text-rose-700">Último intento: {ultimoFallo.error_message}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {puedeRegistrar && (
          <Button size="sm" onClick={registrar} disabled={pending}>
            <Send className="h-4 w-4" />
            {pending ? "Enviando…" : "Registrar en VeriFactu"}
          </Button>
        )}
        {altaViva?.status === "sent" && (
          <Button size="sm" variant="outline" onClick={consultar} disabled={pending}>
            <RefreshCw className="h-4 w-4" />
            Consultar estado
          </Button>
        )}
        {puedeAnular && (
          <Button size="sm" variant="outline" onClick={anular} disabled={pending}>
            <Ban className="h-4 w-4" />
            Anular registro
          </Button>
        )}
      </div>
    </div>
  );
}
