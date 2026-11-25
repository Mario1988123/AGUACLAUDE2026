"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Loader2, Play, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  buscarNegociosAction,
  crearCampanaAction,
  marcarProspectoAction,
  procesarAhoraAction,
  type ProspectoFila,
  type TipologiaFila,
} from "./campanas-actions";
import { PROVINCIAS } from "./busqueda-logica";

const SELECT =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring";

// -----------------------------------------------------------------------------
// Nueva campaña
// -----------------------------------------------------------------------------

export function NuevaCampana({ tipologias }: { tipologias: TipologiaFila[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({
    nombre: "",
    tipologia: tipologias[0]?.clave ?? "",
    tipoZona: "municipio" as "municipio" | "provincia",
    provincia: "ES-V",
    municipio: "",
  });

  if (!abierta) {
    return (
      <Button onClick={() => setAbierta(true)} className="h-12 w-full sm:w-auto">
        Nueva campaña
      </Button>
    );
  }

  function crear() {
    const zona =
      f.tipoZona === "provincia"
        ? { tipo: "provincia" as const, iso: f.provincia }
        : { tipo: "municipio" as const, nombre: f.municipio.trim(), provincia_iso: f.provincia };
    start(async () => {
      const r = await crearCampanaAction({ nombre: f.nombre, tipologia_clave: f.tipologia, zona });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Campaña creada");
      router.push(`/captacion/campanas/${r.id}` as never);
    });
  }

  const tipo = tipologias.find((t) => t.clave === f.tipologia);
  return (
    <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-base font-bold">Nueva campaña</h2>
      <div className="space-y-1.5">
        <Label htmlFor="tipologia">Tipo de negocio</Label>
        <select
          id="tipologia"
          className={SELECT}
          value={f.tipologia}
          onChange={(e) => setF({ ...f, tipologia: e.target.value })}
        >
          {tipologias.map((t) => (
            <option key={t.clave} value={t.clave}>
              {t.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tipoZona">Dónde</Label>
          <select
            id="tipoZona"
            className={SELECT}
            value={f.tipoZona}
            onChange={(e) => setF({ ...f, tipoZona: e.target.value as "municipio" | "provincia" })}
          >
            <option value="municipio">Un municipio</option>
            <option value="provincia">Una provincia entera</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="provincia">Provincia</Label>
          <select
            id="provincia"
            className={SELECT}
            value={f.provincia}
            onChange={(e) => setF({ ...f, provincia: e.target.value })}
          >
            {PROVINCIAS.map((p) => (
              <option key={p.iso} value={p.iso}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      {f.tipoZona === "municipio" ? (
        <div className="space-y-1.5">
          <Label htmlFor="municipio">Municipio</Label>
          <Input
            id="municipio"
            value={f.municipio}
            onChange={(e) => setF({ ...f, municipio: e.target.value })}
            placeholder="Tal como aparece en el mapa: València, Torrent…"
            className="text-base"
          />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre de la campaña</Label>
        <Input
          id="nombre"
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
          placeholder={tipo ? `${tipo.nombre} · ${f.tipoZona === "municipio" ? f.municipio || "municipio" : PROVINCIAS.find((p) => p.iso === f.provincia)?.nombre}` : ""}
          className="text-base"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={crear}
          disabled={pending || !f.nombre.trim() || (f.tipoZona === "municipio" && f.municipio.trim().length < 2)}
          className="h-12"
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Crear campaña
        </Button>
        <Button variant="ghost" onClick={() => setAbierta(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Botones de búsqueda
// -----------------------------------------------------------------------------

export function AccionesBusqueda({
  campanaId,
  hayPendientes,
  places,
}: {
  campanaId: string;
  hayPendientes: boolean;
  places: { configurado: boolean; usadas: number; tope: number };
}) {
  const router = useRouter();
  const [buscando, startBuscar] = useTransition();
  const [procesando, startProcesar] = useTransition();
  const [google, startGoogle] = useTransition();
  const quedan = Math.max(0, places.tope - places.usadas);

  return (
    <div className="space-y-2">
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        variant={hayPendientes ? "outline" : "default"}
        className="h-12"
        disabled={buscando || procesando}
        onClick={() =>
          startBuscar(async () => {
            const r = await buscarNegociosAction(campanaId);
            if (!r.ok) toast.error(r.error);
            else if (r.creadas === 0) toast.info("Ya hay una búsqueda en marcha para esa zona.");
            else toast.success("Búsqueda en cola. Se procesa sola cada noche, o pulsa «Procesar ahora».");
            router.refresh();
          })
        }
      >
        {buscando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
        Buscar negocios
      </Button>
      {hayPendientes ? (
        <Button
          className="h-12"
          disabled={buscando || procesando}
          onClick={() =>
            startProcesar(async () => {
              const r = await procesarAhoraAction(campanaId);
              if (!r.ok) toast.error(r.error);
              else toast.success(r.resumen);
              router.refresh();
            })
          }
        >
          {procesando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {procesando ? "Procesando (hasta 1 minuto)…" : "Procesar ahora"}
        </Button>
      ) : null}
    </div>
    {places.configurado ? (
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <Button
          variant="outline"
          className="h-11"
          disabled={buscando || procesando || google || quedan === 0}
          onClick={() =>
            startGoogle(async () => {
              const r = await buscarNegociosAction(campanaId, "places");
              if (!r.ok) toast.error(r.error);
              else if (r.creadas === 0) toast.info("Ya hay una búsqueda de Google en marcha para esa zona.");
              else toast.success("Búsqueda en Google en cola. Pulsa «Procesar ahora».");
              router.refresh();
            })
          }
        >
          {google ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Buscar también en Google
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {places.usadas} de {places.tope} consultas gratis este mes (todas las empresas)
        </span>
      </div>
    ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta de prospecto
// -----------------------------------------------------------------------------

const FUENTE: Record<string, string> = {
  whatsapp_web: "Enlace de WhatsApp en su web",
  web_propia: "Su web",
  osm: "OpenStreetMap",
  manual: "A mano",
};

function formatoTel(e164: string): string {
  const d = e164.replace("+34", "");
  return `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
}

export function TarjetaProspecto({ p }: { p: ProspectoFila }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const marcar = (accion: "nuevo" | "descartado") =>
    start(async () => {
      const r = await marcarProspectoAction({ id: p.id, accion });
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });

  const conWhatsapp = p.es_movil || p.telefono_fuente === "whatsapp_web";
  const puedePasar = p.etapa !== "nuevo" && conWhatsapp && !p.revisar_motivo?.startsWith("Su teléfono ya es");

  return (
    <li className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{p.nombre_negocio}</div>
          <div className="text-xs text-muted-foreground">
            {[p.direccion, p.municipio].filter(Boolean).join(" · ") || "Sin dirección"}
          </div>
        </div>
        {p.telefono_e164 ? (
          <a href={`tel:${p.telefono_e164}`} className="shrink-0 text-sm font-medium tabular-nums text-primary">
            {formatoTel(p.telefono_e164)}
            {!p.es_movil ? <span className="ml-1 text-xs text-muted-foreground">(fijo con WhatsApp)</span> : null}
          </a>
        ) : null}
      </div>

      {p.revisar_motivo ? (
        <p className="rounded-md bg-warning/15 px-2 py-1 text-xs font-medium">{p.revisar_motivo}</p>
      ) : null}

      {p.telefono_fuente ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Teléfono: {FUENTE[p.telefono_fuente] ?? p.telefono_fuente}</span>
          {p.telefono_url_fuente ? (
            <a
              href={p.telefono_url_fuente}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              ver dónde estaba <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {(p.etapa === "revisar" || p.etapa === "nuevo") ? (
        <div className="flex gap-2 pt-1">
          {puedePasar ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => marcar("nuevo")}>
              Pasar a nuevos
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => marcar("descartado")}>
            Descartar
          </Button>
        </div>
      ) : null}
    </li>
  );
}
