"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Eye,
  Phone,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Home,
  Building2,
  Wrench,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { CustomerBulkToolbar } from "./bulk-toolbar";
import type { CustomerListItem } from "./types";

interface Props {
  customers: CustomerListItem[];
  team: { user_id: string; full_name: string }[];
  canBulkReassign: boolean;
}

function buildMapsUrl(c: CustomerListItem): string | null {
  if (c.address_lat != null && c.address_lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${c.address_lat},${c.address_lng}`;
  }
  if (c.address_city) {
    const q = [c.address_street, c.address_city, c.address_province, "España"]
      .filter(Boolean)
      .join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  return null;
}

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  rental: "Alquiler",
  renting: "Renting",
};

const PLAN_CLASS: Record<string, string> = {
  cash: "bg-emerald-50 border-emerald-200 text-emerald-800",
  rental: "bg-sky-50 border-sky-200 text-sky-800",
  renting: "bg-violet-50 border-violet-200 text-violet-800",
};

function ContractBadge({ type }: { type: CustomerListItem["contract_type"] }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PLAN_CLASS[type] ?? ""}`}
    >
      {PLAN_LABEL[type] ?? type}
    </span>
  );
}

function buildWhatsappUrl(phone: string): string {
  const clean = phone.replace(/[\s\-.()]/g, "");
  const e164 = clean.startsWith("+")
    ? clean
    : clean.startsWith("00")
      ? `+${clean.slice(2)}`
      : /^[6789]\d{8}$/.test(clean)
        ? `+34${clean}`
        : `+${clean}`;
  return `https://wa.me/${e164.replace("+", "")}`;
}

export function SelectableCustomersTable({ customers, team, canBulkReassign }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) =>
      s.size === customers.length ? new Set() : new Set(customers.map((c) => c.id)),
    );
  }

  return (
    <div className="space-y-3">
      {canBulkReassign && (
        <CustomerBulkToolbar
          selectedIds={Array.from(selected)}
          team={team}
          onClear={() => setSelected(new Set())}
        />
      )}

      {customers.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No hay clientes.
        </div>
      ) : (
        <>
          {/* MÓVIL: cards apiladas */}
          <div className="space-y-3 lg:hidden">
            {customers.map((c) => (
              <CustomerCard
                key={c.id}
                c={c}
                selected={selected.has(c.id)}
                onToggle={canBulkReassign ? () => toggle(c.id) : undefined}
              />
            ))}
          </div>

          {/* DESKTOP: tabla */}
          <div className="hidden lg:block overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {canBulkReassign && (
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.size === customers.length && customers.length > 0}
                        onChange={toggleAll}
                        className="h-4 w-4"
                      />
                    </th>
                  )}
                  <th className="w-10 px-3 py-3"></th>
                  <th className="px-3 py-3 text-left">Contacto</th>
                  <th className="px-3 py-3 text-left">Ubicación</th>
                  <th className="px-3 py-3 text-left">Provincia</th>
                  <th className="px-3 py-3 text-left">Equipos</th>
                  <th className="px-3 py-3 text-left">Contrato</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((c) => {
                  const mapsUrl = buildMapsUrl(c);
                  const isCompany = c.party_kind === "company";
                  return (
                    <tr key={c.id} className="hover:bg-muted/30">
                      {canBulkReassign && (
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                            className="h-4 w-4"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2.5 w-10">
                        <span
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                            isCompany
                              ? "bg-violet-100 text-violet-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                          title={isCompany ? "Empresa" : "Particular"}
                          aria-label={isCompany ? "Empresa" : "Particular"}
                        >
                          {isCompany ? (
                            <Building2 className="h-5 w-5" />
                          ) : (
                            <Home className="h-5 w-5" />
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/clientes/${c.id}` as never}
                          className="font-bold text-primary hover:underline"
                        >
                          {c.display_name}
                        </Link>
                        {c.alerts.length > 0 && (
                          <span
                            className="ml-1.5 inline-flex h-5 items-center gap-0.5 rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800 align-middle"
                            title={c.alerts.join(" · ")}
                          >
                            ⚠ {c.alerts.length}
                          </span>
                        )}
                        {isCompany && c.contact_name && (
                          <div className="text-xs text-muted-foreground">{c.contact_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {c.address_street && (
                          <div className="truncate max-w-[200px]" title={c.address_street}>
                            {c.address_street}
                          </div>
                        )}
                        <div className="font-semibold truncate max-w-[200px]">
                          {c.address_city ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold">
                        {c.address_province ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {c.equipment_count > 0 ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-800"
                            title={c.equipment_summary ?? ""}
                          >
                            <Wrench className="h-3 w-3" />
                            <span className="truncate max-w-[140px]">
                              {c.equipment_summary}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <ContractBadge type={c.contract_type} />
                      </td>
                      <td className="px-3 py-2.5">
                        {c.is_active ? (
                          <Badge variant="success">Activo</Badge>
                        ) : (
                          <Badge variant="secondary">Inactivo</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <CustomerActions c={c} mapsUrl={mapsUrl} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CustomerActions({
  c,
  mapsUrl,
}: {
  c: CustomerListItem;
  mapsUrl: string | null;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/clientes/${c.id}` as never}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
        title="Ver ficha"
      >
        <Eye className="h-4 w-4" />
      </Link>
      <Link
        href={`/clientes/${c.id}?edit=1` as never}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
        title="Editar"
      >
        <Pencil className="h-4 w-4" />
      </Link>
      {c.phone_primary && (
        <a
          href={`tel:${c.phone_primary}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
          title={`Llamar ${c.phone_primary}`}
        >
          <Phone className="h-4 w-4" />
        </a>
      )}
      {c.email && (
        <a
          href={`mailto:${c.email}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
          title={`Email a ${c.email}`}
        >
          <Mail className="h-4 w-4" />
        </a>
      )}
      {c.phone_primary && (
        <a
          href={buildWhatsappUrl(c.phone_primary)}
          target="_blank"
          rel="noopener"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-100 hover:text-emerald-600"
          title="WhatsApp"
        >
          <MessageSquare className="h-4 w-4" />
        </a>
      )}
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
          title="Ver en Google Maps"
        >
          <MapPin className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

function CustomerCard({
  c,
  selected,
  onToggle,
}: {
  c: CustomerListItem;
  selected: boolean;
  onToggle?: () => void;
}) {
  const mapsUrl = buildMapsUrl(c);
  const isCompany = c.party_kind === "company";
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-start gap-3">
        {onToggle && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="h-4 w-4 mt-1.5"
          />
        )}
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            isCompany
              ? "bg-violet-100 text-violet-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
          aria-label={isCompany ? "Empresa" : "Particular"}
        >
          {isCompany ? <Building2 className="h-5 w-5" /> : <Home className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/clientes/${c.id}` as never}
              className="font-bold hover:underline truncate"
            >
              {c.display_name}
            </Link>
            {c.alerts.length > 0 && (
              <span
                className="inline-flex h-5 shrink-0 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800"
                title={c.alerts.join(" · ")}
              >
                ⚠ {c.alerts.length}
              </span>
            )}
          </div>
          {isCompany && c.contact_name && (
            <div className="text-xs text-muted-foreground truncate">{c.contact_name}</div>
          )}
          <div className="mt-1 text-xs text-muted-foreground truncate">
            {c.address_city ?? "—"}
            {c.address_province && ` · ${c.address_province}`}
          </div>
        </div>
        {c.is_active ? (
          <Badge variant="success" className="shrink-0">
            Activo
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            Inactivo
          </Badge>
        )}
      </div>
      {(c.equipment_count > 0 || c.contract_type) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {c.equipment_count > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-800"
              title={c.equipment_summary ?? ""}
            >
              <Wrench className="h-3 w-3" />
              <span className="truncate max-w-[160px]">{c.equipment_summary}</span>
            </span>
          )}
          {c.contract_type && <ContractBadge type={c.contract_type} />}
        </div>
      )}
      <div className="pt-1 border-t border-border/50">
        <CustomerActions c={c} mapsUrl={mapsUrl} />
      </div>
    </div>
  );
}
