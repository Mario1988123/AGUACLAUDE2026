"use client";

import { useRouter, useSearchParams } from "next/navigation";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

export function DashboardFilters({
  users,
  showDeptFilter,
}: {
  users: { id: string; name: string }[];
  showDeptFilter: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const dept = sp.get("dept") ?? "";
  const userId = sp.get("user") ?? "";

  function update(key: "dept" | "user", value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/dashboard?${next.toString()}` as never);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {showDeptFilter && (
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Departamento</label>
          <select
            value={dept}
            onChange={(e) => update("dept", e.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(DEPT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs uppercase text-muted-foreground">Comercial</label>
        <select
          value={userId}
          onChange={(e) => update("user", e.target.value)}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {(dept || userId) && (
        <button
          onClick={() => router.push("/dashboard" as never)}
          className="text-sm text-muted-foreground hover:underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
