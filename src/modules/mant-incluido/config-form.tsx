"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { guardarConfigMantAction } from "./actions";
import { N_MAXIMO, centimosAEuros, eur, eurosACentimos, totalConIva } from "./logica";

/** Ajustes de empresa: N por defecto (solo prerrellena) y precio general por tarifa. */
export function ConfigMantIncluidoForm({
  inicial,
  iva,
}: {
  inicial: { nDefecto: number | null; filtros: number | null; membrana: number | null };
  iva: number;
}) {
  const [n, setN] = useState(inicial.nDefecto != null ? String(inicial.nDefecto) : "");
  const [pf, setPf] = useState(centimosAEuros(inicial.filtros));
  const [pm, setPm] = useState(centimosAEuros(inicial.membrana));
  const [pending, start] = useTransition();

  const cf = pf.trim() ? eurosACentimos(pf) : null;
  const cm = pm.trim() ? eurosACentimos(pm) : null;

  function guardar() {
    const nNum = n.trim() === "" ? null : Number(n);
    if (nNum != null && (!Number.isInteger(nNum) || nNum < 0 || nNum > N_MAXIMO)) {
      notify.warning(`El valor por defecto tiene que estar entre 0 y ${N_MAXIMO}`);
      return;
    }
    if ((pf.trim() && cf == null) || (pm.trim() && cm == null)) {
      notify.warning("Algún precio no es válido", "Escribe por ejemplo 75 o 75,50");
      return;
    }
    start(async () => {
      const r = await guardarConfigMantAction({
        n_defecto: nNum,
        precio_filtros_cents: cf,
        precio_membrana_cents: cm,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Guardado");
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="mant-n-defecto">Mantenimientos anuales incluidos por defecto (venta)</Label>
        <Input
          id="mant-n-defecto"
          inputMode="numeric"
          value={n}
          onChange={(e) => setN(e.target.value.replace(/\D/g, ""))}
          placeholder="Sin propuesta"
          className="max-w-32"
        />
        <p className="text-xs text-muted-foreground">
          Solo prerrellena la hoja del equipo: el número de verdad se pone en cada equipo.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mant-pf">Solo filtros (€, sin IVA)</Label>
          <Input id="mant-pf" inputMode="decimal" value={pf} onChange={(e) => setPf(e.target.value)} placeholder="75" />
          {cf != null && (
            <p className="text-xs text-muted-foreground">
              Con IVA ({iva}%): {eur(totalConIva(cf, iva))}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mant-pm">Filtros + membrana (€, sin IVA)</Label>
          <Input id="mant-pm" inputMode="decimal" value={pm} onChange={(e) => setPm(e.target.value)} placeholder="120" />
          {cm != null && (
            <p className="text-xs text-muted-foreground">
              Con IVA ({iva}%): {eur(totalConIva(cm, iva))}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Precio que se aplica si el equipo o el cliente no tienen uno propio. Solo marca la visita a cobrar: no se
        factura nada.
      </p>
      <Button onClick={guardar} disabled={pending}>
        {pending ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  );
}
