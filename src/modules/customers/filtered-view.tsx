"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SelectableCustomersTable } from "./selectable-list";
import type { CustomerListItem } from "./types";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const SELECT_CLS =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm sm:w-auto";

/**
 * Filtro completo de clientes (instantáneo, sin recargar). Opera sobre la
 * lista ya cargada: búsqueda + tipo + estado + equipo + contrato + provincia
 * + comercial + orden. Pinta debajo la tabla con el subconjunto filtrado.
 */
export function CustomersFilteredView({
  customers,
  team,
  canBulkReassign,
}: {
  customers: CustomerListItem[];
  team: { user_id: string; full_name: string }[];
  canBulkReassign: boolean;
}) {
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [equipo, setEquipo] = useState("");
  const [contrato, setContrato] = useState("");
  const [provincia, setProvincia] = useState("");
  const [comercial, setComercial] = useState("");
  const [sort, setSort] = useState("recent");

  const provinces = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) if (c.address_province) set.add(c.address_province);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const filtered = useMemo(() => {
    const s = norm(search);
    let arr = customers.filter((c) => {
      if (s) {
        const hay = norm(
          [c.display_name, c.contact_name, c.email, c.phone_primary]
            .filter(Boolean)
            .join(" "),
        );
        if (!hay.includes(s)) return false;
      }
      if (tipo === "individual" && c.party_kind !== "individual") return false;
      if (tipo === "autonomo" && !(c.party_kind === "company" && c.is_autonomo === true))
        return false;
      if (tipo === "company" && !(c.party_kind === "company" && c.is_autonomo !== true))
        return false;
      if (estado === "active" && !c.is_active) return false;
      if (estado === "inactive" && c.is_active) return false;
      if (equipo === "con" && c.equipment_count === 0) return false;
      if (equipo === "sin" && c.equipment_count > 0) return false;
      if (contrato === "none" && c.contract_type) return false;
      if (
        (contrato === "cash" || contrato === "rental" || contrato === "renting") &&
        c.contract_type !== contrato
      )
        return false;
      if (provincia && (c.address_province ?? "") !== provincia) return false;
      if (comercial === "unassigned" && c.assigned_user_id) return false;
      if (comercial && comercial !== "unassigned" && c.assigned_user_id !== comercial)
        return false;
      return true;
    });
    arr = [...arr].sort((a, b) => {
      if (sort === "oldest")
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "name") return (a.display_name ?? "").localeCompare(b.display_name ?? "");
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return arr;
  }, [customers, search, tipo, estado, equipo, contrato, provincia, comercial, sort]);

  const anyFilter =
    !!search ||
    !!tipo ||
    !!estado ||
    !!equipo ||
    !!contrato ||
    !!provincia ||
    !!comercial ||
    sort !== "recent";

  function clearAll() {
    setSearch("");
    setTipo("");
    setEstado("");
    setEquipo("");
    setContrato("");
    setProvincia("");
    setComercial("");
    setSort("recent");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3 sm:p-4">
        <div className="relative flex-1 min-w-0 sm:min-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, teléfono…"
            aria-label="Buscar clientes"
            className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={SELECT_CLS} aria-label="Tipo">
          <option value="">Cualquier tipo</option>
          <option value="individual">Particular</option>
          <option value="autonomo">Autónomo</option>
          <option value="company">Empresa</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={SELECT_CLS} aria-label="Estado">
          <option value="">Cualquier estado</option>
          <option value="active">Activo</option>
          <option value="inactive">Inactivo</option>
        </select>
        <select value={equipo} onChange={(e) => setEquipo(e.target.value)} className={SELECT_CLS} aria-label="Equipo">
          <option value="">Con o sin equipo</option>
          <option value="con">Con equipo</option>
          <option value="sin">Sin equipo</option>
        </select>
        <select value={contrato} onChange={(e) => setContrato(e.target.value)} className={SELECT_CLS} aria-label="Contrato">
          <option value="">Cualquier contrato</option>
          <option value="cash">Contado</option>
          <option value="rental">Alquiler</option>
          <option value="renting">Renting</option>
          <option value="none">Sin contrato</option>
        </select>
        {provinces.length > 1 && (
          <select value={provincia} onChange={(e) => setProvincia(e.target.value)} className={SELECT_CLS} aria-label="Provincia">
            <option value="">Cualquier provincia</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        {team.length > 0 && (
          <select value={comercial} onChange={(e) => setComercial(e.target.value)} className={SELECT_CLS} aria-label="Comercial">
            <option value="">Cualquier comercial</option>
            <option value="unassigned">⚠ Sin asignar</option>
            {team.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.full_name}
              </option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={SELECT_CLS} aria-label="Orden">
          <option value="recent">Más recientes</option>
          <option value="oldest">Más antiguos</option>
          <option value="name">Nombre A-Z</option>
        </select>
        {anyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-11 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-semibold hover:bg-muted"
          >
            <X className="h-4 w-4" /> Limpiar
          </button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length}
        {filtered.length !== customers.length ? ` de ${customers.length}` : ""} clientes
      </p>

      <SelectableCustomersTable
        customers={filtered}
        team={team}
        canBulkReassign={canBulkReassign}
      />
    </div>
  );
}
