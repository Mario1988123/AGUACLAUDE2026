"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, ChevronRight, KeyRound } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { MODELOS_IA } from "./asistente-comun";
import { guardarAsistenteAction } from "./asistente-actions";

/**
 * Tarjeta del asistente en /configuracion/captacion: interruptor (solo se
 * enciende con la clave de Anthropic en el servidor) y modelo.
 */
export function PanelAsistente({
  estado,
}: {
  estado: { activa: boolean; modelo: string; hayClave: boolean; esAdmin: boolean };
}) {
  const [activa, setActiva] = useState(estado.activa);
  const [modelo, setModelo] = useState(estado.modelo);
  const [pending, start] = useTransition();
  const disabled = !estado.esAdmin || pending;
  const nota = MODELOS_IA.find((m) => m.id === modelo)?.nota;

  function guardar(siguiente: { activa: boolean; modelo: string }) {
    start(async () => {
      const r = await guardarAsistenteAction(siguiente);
      if (!r.ok) {
        toast.error(r.error);
        setActiva(estado.activa);
        setModelo(estado.modelo);
        return;
      }
      toast.success(siguiente.activa ? "Asistente encendido" : "Asistente guardado");
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="ia-activa" className="flex items-center gap-2 text-base font-bold">
            <Bot className="h-4 w-4" aria-hidden /> Asistente de IA
          </Label>
          <p className="text-xs text-muted-foreground">
            Contesta el texto libre de los negocios de tus campañas con tu FAQ, tus documentos y los
            equipos de la campaña. Se presenta como asistente automático en su primer mensaje, no da
            precios que no estén en Productos y se calla en cuanto alguien escribe desde aquí o
            desde el móvil.
          </p>
        </div>
        <Switch
          id="ia-activa"
          checked={activa}
          disabled={disabled || (!estado.hayClave && !activa)}
          onCheckedChange={(v) => {
            setActiva(v);
            guardar({ activa: v, modelo });
          }}
        />
      </div>

      {!estado.hayClave ? (
        <div className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Falta la clave de Anthropic en el servidor. Hasta que Vercomi la ponga, el asistente no se puede encender.</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="ia-modelo">Modelo</Label>
        <select
          id="ia-modelo"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          value={modelo}
          disabled={disabled}
          onChange={(e) => {
            setModelo(e.target.value);
            guardar({ activa, modelo: e.target.value });
          }}
        >
          {MODELOS_IA.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        {nota ? <p className="text-xs text-muted-foreground">{nota}</p> : null}
      </div>

      <Button asChild variant="outline" className="h-11 w-full justify-between sm:w-auto">
        <Link href={"/configuracion/captacion/faq" as never}>
          FAQ, documentos y chat de prueba <ChevronRight className="ml-2 h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
