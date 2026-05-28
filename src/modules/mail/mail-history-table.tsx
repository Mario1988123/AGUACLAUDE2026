"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  Search,
  Download,
  Filter,
  RefreshCw,
  Eye,
  Loader2,
  Mail as MailIcon,
} from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  listMailHistory,
  exportMailCsvAction,
  type MailRow,
  type MailHistoryFilters,
} from "./actions";

const SEND_TYPE_LABEL: Record<string, string> = {
  manual: "Manual",
  automated: "Auto",
  campaign: "Campaña",
};

const TRIGGER_LABEL: Record<string, string> = {
  maintenance_reminder: "Recordatorio mantenimiento",
  appointment_reminder: "Recordatorio cita",
  appointment_confirmation: "Confirmación cita",
  appointment_cancelled: "Cita cancelada",
  contract_sent: "Contrato enviado",
  contract_signed: "Contrato firmado",
  payment_reminder: "Recordatorio pago",
  invoice_sent: "Factura enviada",
  client_welcome: "Bienvenida cliente",
  lead_assigned: "Lead asignado",
  proposal_sent: "Propuesta enviada",
  password_reset: "Restablecer contraseña",
  test_send: "Prueba",
  manual_send: "Manual",
  campaign_send: "Campaña",
  incident_notification: "Incidencia",
  gmaps_budget_alert: "Alerta Google Maps",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  sent: "default",
  delivered: "default",
  queued: "secondary",
  sending: "secondary",
  failed: "destructive",
  bounced: "destructive",
  complained: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregado",
  queued: "En cola",
  sending: "Enviando",
  failed: "Error",
  bounced: "Rebotado",
  complained: "Spam",
};

interface Props {
  isAdmin: boolean;
}

const EMPTY_FILTERS: MailHistoryFilters = {
  search: "",
  status: undefined,
  sendType: undefined,
  triggerEvent: undefined,
  fromDate: undefined,
  toDate: undefined,
};

export function MailHistoryTable({ isAdmin }: Props) {
  const [filters, setFilters] = useState<MailHistoryFilters>(EMPTY_FILTERS);
  const [debounced, setDebounced] = useState<MailHistoryFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<MailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, startLoad] = useTransition();
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 350);
    return () => clearTimeout(t);
  }, [filters]);

  useEffect(() => {
    startLoad(async () => {
      const r = await listMailHistory({
        ...debounced,
        limit: pageSize,
        offset: page * pageSize,
      });
      setRows(r.rows);
      setTotal(r.total);
    });
  }, [debounced, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function exportCsv() {
    const csv = await exportMailCsvAction(debounced);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mail-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {loading ? "Cargando…" : `${total} emails`}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(0);
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Limpiar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filtros
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={exportCsv} className="gap-2">
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por destinatario, nombre o asunto…"
              value={filters.search ?? ""}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          {showFilters && (
            <div className="grid gap-3 border-t pt-2 sm:grid-cols-2 lg:grid-cols-3">
              <select
                className="h-9 rounded-md border px-3 text-sm"
                value={filters.sendType ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    sendType: (e.target.value || undefined) as MailHistoryFilters["sendType"],
                  })
                }
              >
                <option value="">Cualquier tipo</option>
                <option value="manual">Manuales</option>
                <option value="automated">Automáticos</option>
                <option value="campaign">Campañas</option>
              </select>
              <select
                className="h-9 rounded-md border px-3 text-sm"
                value={filters.status ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    status: (e.target.value || undefined) as MailHistoryFilters["status"],
                  })
                }
              >
                <option value="">Cualquier estado</option>
                <option value="sent">Enviado</option>
                <option value="delivered">Entregado</option>
                <option value="failed">Error</option>
                <option value="bounced">Rebotado</option>
                <option value="queued">En cola</option>
              </select>
              <select
                className="h-9 rounded-md border px-3 text-sm"
                value={filters.triggerEvent ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, triggerEvent: e.target.value || undefined })
                }
              >
                <option value="">Cualquier evento</option>
                {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={filters.fromDate?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    fromDate: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
                  })
                }
                placeholder="Desde"
              />
              <Input
                type="date"
                value={filters.toDate?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    toDate: e.target.value ? `${e.target.value}T23:59:59Z` : undefined,
                  })
                }
                placeholder="Hasta"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <MailIcon className="mx-auto mb-3 h-12 w-12 opacity-40" />
              {loading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                <p>No hay emails que coincidan con tus filtros</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="p-3 text-left">Fecha</th>
                    <th className="p-3 text-left">Destinatario</th>
                    <th className="p-3 text-left">Asunto</th>
                    <th className="p-3 text-left">Tipo</th>
                    <th className="p-3 text-left">Evento</th>
                    <th className="p-3 text-left">Estado</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="whitespace-nowrap p-3 text-xs">
                        {new Date(r.created_at).toLocaleString("es-ES")}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{r.to_email}</div>
                        {r.to_name && (
                          <div className="text-xs text-muted-foreground">{r.to_name}</div>
                        )}
                      </td>
                      <td className="max-w-xs truncate p-3">{r.subject}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {SEND_TYPE_LABEL[r.send_type ?? ""] ?? r.send_type ?? "—"}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {TRIGGER_LABEL[r.trigger_event ?? ""] ?? r.trigger_event ?? "—"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={STATUS_VARIANT[r.status] ?? "outline"}
                          className="text-xs"
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Link href={`/mail/${r.id}`}>
                          <Button size="sm" variant="ghost">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
