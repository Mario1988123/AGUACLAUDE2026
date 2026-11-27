"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { guardarPropuestaCampanaAction, type PropuestaCampana } from "./propuesta-actions";

const SELECT =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring";
const MAX_EQUIPOS = 6;
const MAX_CARTA = 280;

/**
 * Mando de la propuesta de la campaña: equipos (en orden; el primero es el
 * recomendado), carta y «Qué incluye». Los precios se activan por empresa en
 * Configuración → Captación.
 */
export function MandoPropuesta({ campanaId, datos }: { campanaId: string; datos: PropuestaCampana }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [equipos, setEquipos] = useState(datos.equipos);
  const [carta, setCarta] = useState(datos.textoCarta ?? "");
  const [incluye, setIncluye] = useState(datos.queIncluye ?? "");
  const disponibles = [...datos.disponibles, ...datos.equipos].filter((p) => !equipos.some((e) => e.id === p.id));

  function mover(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= equipos.length) return;
    const n = [...equipos];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setEquipos(n);
  }

  function guardar() {
    start(async () => {
      const r = await guardarPropuestaCampanaAction({
        campanaId,
        productIds: equipos.map((e) => e.id),
        textoCarta: carta.trim() || null,
        queIncluye: incluye.trim() || null,
      });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Propuesta guardada");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-5 rounded-xl border border-border p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-bold">Propuesta</h2>
        <p className="text-sm text-muted-foreground">
          Lo que recibe quien dice «Sí»: un PDF y una página con estos equipos.
          {datos.enviadas > 0 ? ` Enviadas: ${datos.enviadas}; abiertas: ${datos.abiertas}.` : ""}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Equipos (hasta {MAX_EQUIPOS})</Label>
        <p className="text-xs text-muted-foreground">El primero es el recomendado y sale grande.</p>
        {equipos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin equipos no se manda propuesta.</p>
        ) : (
          <ol className="divide-y divide-border rounded-md border border-border">
            {equipos.map((e, i) => (
              <li key={e.id} className="flex items-center gap-2 py-1 pl-3 pr-1">
                <span className="w-5 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{e.nombre}</span>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Bajar"
                  disabled={i === equipos.length - 1}
                  onClick={() => mover(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={`Quitar ${e.nombre}`}
                  onClick={() => setEquipos(equipos.filter((x) => x.id !== e.id))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {equipos.length < MAX_EQUIPOS && disponibles.length > 0 ? (
          <select
            className={SELECT}
            value=""
            aria-label="Añadir un equipo"
            onChange={(ev) => {
              const p = disponibles.find((x) => x.id === ev.target.value);
              if (p) setEquipos([...equipos, p]);
            }}
          >
            <option value="">Añadir un equipo…</option>
            {disponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="carta">Carta</Label>
        <Textarea
          id="carta"
          rows={4}
          maxLength={MAX_CARTA}
          value={carta}
          onChange={(e) => setCarta(e.target.value)}
          placeholder="Vacío: «Nos pedisteis que os contáramos más. Estos son los equipos que solemos instalar en negocios como el vuestro…»"
          className="text-base"
        />
        <p className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>Tratad de vosotros. {"{{negocio}}"} se cambia por el nombre del negocio.</span>
          <span className="shrink-0 tabular-nums">
            {carta.length}/{MAX_CARTA}
          </span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="incluye">Qué incluye</Label>
        <Textarea
          id="incluye"
          rows={4}
          maxLength={400}
          value={incluye}
          onChange={(e) => setIncluye(e.target.value)}
          placeholder={"Una línea por punto, hasta cuatro. Vacío: el bloque no sale.\nInstalación por nuestros técnicos."}
          className="text-base"
        />
        <p className="text-xs text-muted-foreground">Solo lo que hacéis de verdad: sale tal cual en la propuesta.</p>
      </div>

      <p className="text-sm text-muted-foreground">
        Precios: {datos.conPrecios ? "se enseñan" : "no se enseñan"}.{" "}
        <Link href={"/configuracion/captacion" as never} className="underline underline-offset-2">
          Cambiarlo en Configuración
        </Link>
      </p>

      <Button onClick={guardar} disabled={pending} className="h-12 w-full sm:w-auto">
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Guardar propuesta
      </Button>
    </section>
  );
}
