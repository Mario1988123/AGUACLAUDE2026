"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { Badge } from "@/shared/ui/badge";
import {
  lookupSerialNumber,
  type SnLookupResult,
} from "./sn-lookup-actions";

export function SnLookup() {
  const [sn, setSn] = useState("");
  const [results, setResults] = useState<SnLookupResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  function search() {
    if (sn.trim().length < 2) {
      notify.warning("Introduce al menos 2 caracteres");
      return;
    }
    startTransition(async () => {
      const r = await lookupSerialNumber(sn.trim());
      setResults(r);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={sn}
          onChange={(e) => setSn(e.target.value)}
          placeholder="Número de serie (parcial)"
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
        />
        <Button onClick={search} disabled={pending} className="gap-2">
          <Search className="h-4 w-4" /> Buscar
        </Button>
      </div>

      {results != null && (
        <div className="rounded-xl border bg-card">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Sin coincidencias.
            </p>
          ) : (
            <ul className="divide-y">
              {results.map((r) => (
                <li key={r.equipment_id} className="p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {r.serial_number}
                    </code>
                    {r.status && <Badge variant="outline">{r.status}</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {r.product_name && <span>{r.product_name} · </span>}
                    {r.customer_id ? (
                      <Link
                        href={`/clientes/${r.customer_id}` as never}
                        className="text-primary hover:underline"
                      >
                        {r.customer_name}
                      </Link>
                    ) : (
                      <span>Sin cliente</span>
                    )}
                    {r.contract_id && (
                      <>
                        {" · "}
                        <Link
                          href={`/contratos/${r.contract_id}` as never}
                          className="text-primary hover:underline"
                        >
                          {r.contract_ref}
                        </Link>
                      </>
                    )}
                    {r.installed_at && (
                      <span>
                        {" · "}Instalado {new Date(r.installed_at).toLocaleDateString("es-ES")}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
