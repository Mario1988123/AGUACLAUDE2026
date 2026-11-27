import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { formatoEuros, formatoTasa, TARIFAS_ES_MILICENTIMOS } from "./mando-logica";
import type { DatosMando } from "./mando-servidor";

/**
 * Mando de la fase 7: embudo por etapas, gasto del mes frente al tope y
 * campañas pausadas con su motivo. Componente de servidor, sin estado: lo
 * pintan /captacion (toda la empresa) y /captacion/campanas/[id] (una).
 * Móvil primero: una columna a 390 px, filas de una línea.
 */

const NOMBRE_MES = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "Europe/Madrid" });

function Medidor({ porcentaje, nivel }: { porcentaje: number | null; nivel: "ok" | "aviso" | "tope" }) {
  const ancho = Math.min(100, Math.max(0, porcentaje ?? 100));
  return (
    <div
      role="meter"
      aria-label="Gasto del mes sobre el tope"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ancho)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          nivel === "tope" ? "bg-destructive" : nivel === "aviso" ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${ancho}%` }}
      />
    </div>
  );
}

function Fila({
  etiqueta,
  ayuda,
  valor,
  tasa,
  base,
  maximo,
}: {
  etiqueta: string;
  ayuda?: string;
  valor: number;
  tasa?: number | null;
  base?: string;
  maximo: number;
}) {
  const ancho = maximo > 0 ? Math.max(valor > 0 ? 2 : 0, (valor / maximo) * 100) : 0;
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-medium">
          {etiqueta}
          {ayuda ? <span className="block text-xs font-normal text-muted-foreground">{ayuda}</span> : null}
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="text-base font-bold">{valor.toLocaleString("es-ES")}</span>
          {tasa !== undefined ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {formatoTasa(tasa)}
              {base ? ` ${base}` : ""}
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/60" aria-hidden>
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${ancho}%` }} />
      </div>
    </li>
  );
}

export function PanelMando({ datos, campanaId }: { datos: DatosMando; campanaId?: string }) {
  const { embudo: e, tasas: t, gasto: g, gastoCampana: gc } = datos;
  const pausadasAuto = datos.pausadas.filter((p) => p.automatica && p.motivo);
  const maximo = Math.max(e.contactados, 1);
  const mes = NOMBRE_MES.format(new Date());

  return (
    <section className="space-y-5 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="mando-titulo">
      <h2 id="mando-titulo" className="text-base font-bold">
        {campanaId ? "Embudo de la campaña" : "Embudo y gasto"}
      </h2>

      {pausadasAuto.length > 0 ? (
        <ul className="space-y-2">
          {pausadasAuto.map((p) => (
            <li key={p.id} className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
              <p className="font-bold">
                {campanaId ? (
                  "Pausada por el sistema"
                ) : (
                  <>
                    <Link href={`/captacion/campanas/${p.id}` as never} className="underline underline-offset-2">
                      {p.nombre}
                    </Link>
                    <span className="font-normal"> · pausada por el sistema</span>
                  </>
                )}
              </p>
              <p className="mt-0.5">{p.motivo}</p>
              <p className="mt-1 text-xs text-muted-foreground">No se reanuda sola: revísalo y reanúdala a mano.</p>
            </li>
          ))}
        </ul>
      ) : null}

      {g ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground">Gasto de {mes}</span>
            <span className="tabular-nums">
              <span className="text-lg font-bold">{formatoEuros(g.comprometidoMilicentimos)}</span>
              <span className="text-sm text-muted-foreground"> de {formatoEuros(g.topeCents * 1000)}</span>
            </span>
          </div>
          <Medidor porcentaje={g.porcentaje} nivel={g.nivel} />
          {g.nivel === "tope" ? (
            <p className="text-sm font-medium">Tope alcanzado: no sale ningún mensaje en frío más este mes.</p>
          ) : g.nivel === "aviso" ? (
            <p className="text-sm font-medium">Pasa del 80 % del tope. Al llegar al 100 % se paran los envíos en frío.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Suma de los mensajes entregados ({g.cobrados.toLocaleString("es-ES")}) a la tarifa de España
            {g.enVueloMilicentimos > 0
              ? `, más ${(g.enVueloMilicentimos / TARIFAS_ES_MILICENTIMOS.marketing).toLocaleString("es-ES")} enviados que aún no constan como entregados, contados a ${formatoEuros(TARIFAS_ES_MILICENTIMOS.marketing)}`
              : ""}
            . Es una estimación: lo que cuenta es la factura de Meta.
          </p>
          {gc ? (
            <p className="text-xs text-muted-foreground">
              Esta campaña: {formatoEuros(gc.mesMilicentimos)} en {mes} · {formatoEuros(gc.totalMilicentimos)} en total.
            </p>
          ) : null}
        </div>
      ) : null}

      {e.contactados === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aún no ha salido ningún mensaje{e.enCola > 0 ? `; hay ${e.enCola.toLocaleString("es-ES")} negocios en cola` : ""}.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          <Fila etiqueta="Contactados" ayuda="Primer mensaje enviado" valor={e.contactados} maximo={maximo} />
          <Fila etiqueta="Entregados" valor={e.entregados} tasa={t.entrega} maximo={maximo} />
          <Fila etiqueta="Recordados" ayuda="Recordatorio a los 15 días" valor={e.recordados} maximo={maximo} />
          <Fila etiqueta="Dijeron «Sí»" valor={e.si} tasa={t.si} base="de entregados" maximo={maximo} />
          <Fila etiqueta="Dijeron «No»" ayuda="O pidieron la baja" valor={e.no} tasa={t.no} base="de entregados" maximo={maximo} />
          <Fila etiqueta="Interesados" ayuda="Pidieron que les llamen" valor={e.interesados} tasa={t.interes} base="de entregados" maximo={maximo} />
          <Fila etiqueta="Leads creados" valor={e.leads} maximo={maximo} />
          <Fila etiqueta="Sin respuesta" ayuda="Ni al primero ni al recordatorio" valor={e.sinRespuesta} tasa={t.sinRespuesta} base="de entregados" maximo={maximo} />
        </ol>
      )}
      {e.contactados > 0 && (e.conversando > 0 || e.fallidos > 0 || e.enCola > 0) ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {[
            e.enCola > 0 ? `${e.enCola.toLocaleString("es-ES")} en cola` : null,
            e.conversando > 0 ? `${e.conversando.toLocaleString("es-ES")} escribiendo en la bandeja` : null,
            e.fallidos > 0 ? `${e.fallidos.toLocaleString("es-ES")} sin WhatsApp` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
