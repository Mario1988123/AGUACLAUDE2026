"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/shared/ui/badge";
import { CustomerBulkToolbar } from "./bulk-toolbar";
import type { CustomerListItem } from "./types";

interface Props {
  customers: CustomerListItem[];
  team: { user_id: string; full_name: string }[];
  canBulkReassign: boolean;
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
      <div className="overflow-hidden rounded-lg border bg-card">
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
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Contacto</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {customers.length === 0 ? (
              <tr>
                <td
                  colSpan={canBulkReassign ? 6 : 5}
                  className="p-8 text-center text-muted-foreground"
                >
                  No hay clientes.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  {canBulkReassign && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link
                      href={`/clientes/${c.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.party_kind === "company" ? "Empresa" : "Particular"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.phone_primary && <div>{c.phone_primary}</div>}
                    {c.email && <div className="text-muted-foreground">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {c.is_active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/clientes/${c.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
