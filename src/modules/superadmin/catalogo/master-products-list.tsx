"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { CatalogProductListItem } from "./master-products-actions";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function MasterProductsList({
  products,
  manufacturers,
}: {
  products: CatalogProductListItem[];
  manufacturers: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [man, setMan] = useState("");

  const filtered = useMemo(() => {
    const s = norm(search);
    return products.filter((p) => {
      if (man && p.manufacturer_id !== man) return false;
      if (s) {
        const hay = norm(`${p.name} ${p.supplier_reference} ${p.manufacturer_name ?? ""}`);
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [products, search, man]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={man}
          onChange={(e) => setMan(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los fabricantes</option>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length}
        {filtered.length !== products.length ? ` de ${products.length}` : ""} productos
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No hay productos maestros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 text-left">Producto</th>
                <th className="px-3 py-3 text-left">Ref. proveedor</th>
                <th className="px-3 py-3 text-left">Fabricante</th>
                <th className="px-3 py-3 text-left">Versión</th>
                <th className="px-3 py-3 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/superadmin/catalogo/productos/${p.id}` as never}
                      className="font-semibold text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{p.supplier_reference}</td>
                  <td className="px-3 py-2.5">{p.manufacturer_name ?? "—"}</td>
                  <td className="px-3 py-2.5">v{p.version}</td>
                  <td className="px-3 py-2.5">
                    {p.is_active ? (
                      <span className="text-emerald-700">Activo</span>
                    ) : (
                      <span className="text-muted-foreground">Inactivo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
