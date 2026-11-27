"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { StatusPill } from "@/shared/components/status-pill";
import { sincronizarPlantillasAction } from "./conexion-actions";
import { asignarUsoPlantillaAction, crearPlantillaDocumentoAction, crearPlantillaMetaAction } from "./plantillas-actions";
import {
  BOTON_NO,
  BOTON_SI,
  MAX_CUERPO_PLANTILLA,
  MAX_PIE_PLANTILLA,
  PROPUESTA_DOCUMENTO,
  PROPUESTA_INFINITY,
  renderizarCuerpo,
  type CategoriaDocumento,
  type UsoPlantilla,
} from "./envios-logica";
import type { PlantillaCaptacion } from "./tipos";

const SELECT =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring";

const ESTADO: Record<PlantillaCaptacion["estado"], { label: string; tone: "success" | "onhold" | "rejected" | "neutral" | "info" }> = {
  aprobada: { label: "Aprobada", tone: "success" },
  pendiente: { label: "En revisión", tone: "info" },
  rechazada: { label: "Rechazada", tone: "rejected" },
  pausada: { label: "Pausada", tone: "onhold" },
  desactivada: { label: "Desactivada", tone: "neutral" },
};

/** Fase 8: «documento» = la propuesta en PDF cuando la ventana de 24 h ya se cerró. */
type UsoFormulario = UsoPlantilla | "documento";

const USO: Record<UsoFormulario, string> = {
  primer_contacto: "Primer mensaje",
  recordatorio: "Recordatorio",
  documento: "Propuesta fuera de las 24 h",
};

export function PlantillasCaptacion({
  plantillas,
  esAdmin,
  wabaId,
  conectada,
}: {
  plantillas: PlantillaCaptacion[];
  esAdmin: boolean;
  wabaId: string | null;
  conectada: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-bold">Plantillas</h2>
        <p className="text-sm text-muted-foreground">
          El primer mensaje y el recordatorio salen siempre con una plantilla que Meta ha revisado.
          La revisión suele tardar de unos minutos a un día.
        </p>
      </div>

      {plantillas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna.</p>
      ) : (
        <ul className="divide-y divide-border">
          {plantillas.map((p) => (
            <FilaPlantilla key={p.id} p={p} esAdmin={esAdmin} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {esAdmin ? (
          <Button
            variant="outline"
            className="h-11"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await sincronizarPlantillasAction();
                if (!r.ok) toast.error(r.error);
                else toast.success(`Plantillas al día (${r.total ?? 0})`);
              })
            }
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Traer plantillas de Meta
          </Button>
        ) : null}
        {wabaId ? (
          <Button variant="ghost" className="h-11" asChild>
            <a
              href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver en el administrador de Meta
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>

      {esAdmin && conectada ? <NuevaPlantilla /> : null}
    </section>
  );
}

function FilaPlantilla({ p, esAdmin }: { p: PlantillaCaptacion; esAdmin: boolean }) {
  const [pending, start] = useTransition();
  const usoActual: UsoFormulario | "" = p.uso ?? "";
  const puedeUsarse = p.estado === "aprobada" && (p.sirveCaptacion || p.sirveDocumento);

  function cambiarUso(v: string) {
    start(async () => {
      const r = await asignarUsoPlantillaAction({ plantillaId: p.id, uso: v === "" ? null : v });
      if (!r.ok) toast.error(r.error);
      else toast.success(v === "" ? "Plantilla sin uso" : `Se usará para: ${USO[v as UsoFormulario].toLowerCase()}`);
    });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{p.nombre}</div>
          <div className="text-xs text-muted-foreground">
            {p.idioma} · {p.categoria === "marketing" ? "Marketing" : p.categoria === "utility" ? "Servicio" : "Autenticación"}
            {usoActual ? ` · ${USO[usoActual]}` : ""}
            {p.motivo_rechazo ? ` · ${p.motivo_rechazo}` : ""}
          </div>
        </div>
        <StatusPill {...ESTADO[p.estado]} className="shrink-0" />
      </div>
      {p.cuerpo ? <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{p.cuerpo}</p> : null}
      {esAdmin && puedeUsarse ? (
        <div className="space-y-1">
          <Label htmlFor={`uso-${p.id}`} className="text-xs">
            Para qué se usa
          </Label>
          <select
            id={`uso-${p.id}`}
            className={SELECT}
            value={usoActual}
            disabled={pending}
            onChange={(e) => cambiarUso(e.target.value)}
          >
            <option value="">Ninguno</option>
            {p.sirveDocumento ? (
              <option value="documento">Mandar la propuesta (PDF) cuando ya han pasado 24 h</option>
            ) : (
              <>
                <option value="primer_contacto">Primer mensaje a un negocio</option>
                <option value="recordatorio">Recordatorio a los 15 días</option>
              </>
            )}
          </select>
        </div>
      ) : p.estado === "aprobada" && !p.sirveCaptacion && p.motivoNoSirve ? (
        <p className="text-xs text-muted-foreground">No sirve para captación: {p.motivoNoSirve}</p>
      ) : null}
    </li>
  );
}

/** Vista tal como se verá en WhatsApp, con los dos botones debajo. */
function VistaPrevia({
  cuerpo,
  pie,
  ejemplo,
  documento = false,
}: {
  cuerpo: string;
  pie: string;
  ejemplo: string;
  documento?: boolean;
}) {
  const texto = renderizarCuerpo(cuerpo, ejemplo || "Nombre del negocio") ?? "";
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="max-w-[85%] space-y-0 overflow-hidden rounded-2xl rounded-tl-md border border-border bg-background shadow-sm">
        {documento ? (
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5 text-sm">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium">Propuesta.pdf</span>
          </div>
        ) : null}
        <div className="px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{texto}</p>
          {pie.trim() ? <p className="mt-1 text-xs text-muted-foreground">{pie}</p> : null}
        </div>
        {documento ? null : (
          <div className="divide-y divide-border border-t border-border text-center text-sm font-medium text-sky-700 dark:text-sky-400">
            <div className="py-2">{BOTON_SI}</div>
            <div className="py-2">{BOTON_NO}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function NuevaPlantilla() {
  const [abierta, setAbierta] = useState(false);
  const [pending, start] = useTransition();
  const [uso, setUso] = useState<UsoFormulario>("primer_contacto");
  const [categoria, setCategoria] = useState<CategoriaDocumento>("utility");
  const [f, setF] = useState(() => ({ ...PROPUESTA_INFINITY.primer_contacto, pie: PROPUESTA_INFINITY.primer_contacto.pie ?? "" }));
  const esDocumento = uso === "documento";

  if (!abierta) {
    return (
      <Button variant="outline" className="h-12 w-full sm:w-auto" onClick={() => setAbierta(true)}>
        Crear plantilla nueva
      </Button>
    );
  }

  function cambiarUso(v: UsoFormulario) {
    setUso(v);
    if (v === "documento") {
      const { categoria: cat, ...prop } = PROPUESTA_DOCUMENTO;
      setCategoria(cat);
      setF({ ...prop, pie: prop.pie ?? "" });
      return;
    }
    const prop = PROPUESTA_INFINITY[v];
    setF({ ...prop, pie: prop.pie ?? "" });
  }

  function enviar() {
    start(async () => {
      const datos = {
        nombre: f.nombre.trim(),
        cuerpo: f.cuerpo,
        pie: f.pie.trim() || null,
        ejemplo: f.ejemplo,
      };
      const r = esDocumento
        ? await crearPlantillaDocumentoAction({ ...datos, categoria })
        : await crearPlantillaMetaAction(datos);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.aviso) toast.warning(r.aviso, { duration: 15_000 });
      else toast.success("Enviada a Meta. Cuando la aprueben, elige aquí para qué se usa.");
      setAbierta(false);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
      <div className="space-y-1">
        <h3 className="font-bold">Plantilla nueva</h3>
        <p className="text-xs text-muted-foreground">
          {esDocumento ? (
            <>
              Lleva un texto propuesto: revísalo antes de enviarlo. {"{{1}}"} es el nombre del negocio. Arriba va
              el PDF de la propuesta; a Meta se le manda un PDF de ejemplo sin datos de nadie.
            </>
          ) : (
            <>
              Lleva un texto propuesto: revísalo antes de enviarlo. {"{{1}}"} es el nombre del negocio. Los
              botones «{BOTON_SI}» y «{BOTON_NO}» se añaden solos.
            </>
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pl-uso">Para qué es</Label>
        <select id="pl-uso" className={SELECT} value={uso} onChange={(e) => cambiarUso(e.target.value as UsoFormulario)}>
          <option value="primer_contacto">Primer mensaje</option>
          <option value="recordatorio">Recordatorio</option>
          <option value="documento">Propuesta (PDF) cuando ya han pasado 24 h</option>
        </select>
        {esDocumento ? (
          <p className="text-xs text-muted-foreground">
            Si alguien dice «Sí» y el PDF no le llega a tiempo, WhatsApp ya no deja mandarlo como un mensaje normal:
            sale con esta plantilla, que se cobra como un mensaje más.
          </p>
        ) : null}
      </div>

      {esDocumento ? (
        <div className="space-y-1.5">
          <Label htmlFor="pl-categoria">Categoría en Meta</Label>
          <select
            id="pl-categoria"
            className={SELECT}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaDocumento)}
          >
            <option value="utility">Servicio (utility): responde a lo que ha pedido</option>
            <option value="marketing">Marketing</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Meta puede cambiar la categoría al revisarla si el texto le parece promocional.
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="pl-nombre">Nombre en Meta</Label>
        <Input
          id="pl-nombre"
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
          className="text-base"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <p className="text-xs text-muted-foreground">Minúsculas, números y guiones bajos.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pl-cuerpo">Texto</Label>
        <Textarea
          id="pl-cuerpo"
          rows={7}
          value={f.cuerpo}
          maxLength={MAX_CUERPO_PLANTILLA}
          onChange={(e) => setF({ ...f, cuerpo: e.target.value })}
          className="text-base"
        />
        <p className="text-right text-xs tabular-nums text-muted-foreground">
          {f.cuerpo.length} / {MAX_CUERPO_PLANTILLA}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pl-pie">Pie (opcional)</Label>
          <Input
            id="pl-pie"
            value={f.pie}
            maxLength={MAX_PIE_PLANTILLA}
            onChange={(e) => setF({ ...f, pie: e.target.value })}
            className="text-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-ejemplo">Negocio de ejemplo para Meta</Label>
          <Input
            id="pl-ejemplo"
            value={f.ejemplo}
            onChange={(e) => setF({ ...f, ejemplo: e.target.value })}
            className="text-base"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Así se verá</p>
        <VistaPrevia cuerpo={f.cuerpo} pie={f.pie} ejemplo={f.ejemplo} documento={esDocumento} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="h-12" disabled={pending} onClick={enviar}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Enviar a Meta para revisión
        </Button>
        <Button variant="ghost" className="h-12" disabled={pending} onClick={() => setAbierta(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
