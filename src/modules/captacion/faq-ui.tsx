"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bot, Loader2, Pencil, Plus, RotateCcw, Send, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { cn } from "@/shared/lib/utils";
import { contienePrecio } from "./asistente-comun";
import {
  borrarDocumentoAction,
  borrarFaqAction,
  guardarDocumentoAction,
  guardarFaqAction,
  moverDocumentoAction,
  moverFaqAction,
  probarAsistenteAction,
  type DatosFaq,
  type DocumentoVista,
  type FaqVista,
} from "./asistente-actions";

/**
 * /configuracion/captacion/faq (plan §6.5): preguntas frecuentes, documentos
 * y chat de prueba del asistente. Gestores editan; comerciales leen.
 */
export function PantallaFaq({ datos }: { datos: DatosFaq }) {
  return (
    <Tabs defaultValue="faq" className="space-y-4">
      <TabsList className="grid h-11 w-full grid-cols-3">
        <TabsTrigger value="faq" className="h-9">Preguntas</TabsTrigger>
        <TabsTrigger value="docs" className="h-9">Documentos</TabsTrigger>
        <TabsTrigger value="prueba" className="h-9">Probar</TabsTrigger>
      </TabsList>
      <TabsContent value="faq">
        <ListaFaq datos={datos} />
      </TabsContent>
      <TabsContent value="docs">
        <ListaDocumentos datos={datos} />
      </TabsContent>
      <TabsContent value="prueba">
        <ChatPrueba datos={datos} />
      </TabsContent>
    </Tabs>
  );
}

function BotonesOrden({ primero, ultimo, disabled, onMover }: { primero: boolean; ultimo: boolean; disabled: boolean; onMover: (h: "arriba" | "abajo") => void }) {
  return (
    <div className="flex shrink-0 flex-col">
      <Button variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || primero} onClick={() => onMover("arriba")} aria-label="Subir">
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || ultimo} onClick={() => onMover("abajo")} aria-label="Bajar">
        <ArrowDown className="h-4 w-4" />
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// FAQ
// -----------------------------------------------------------------------------

type BorradorFaq = { id: string | null; pregunta: string; respuesta: string; campanaId: string | null; activa: boolean };

function ListaFaq({ datos }: { datos: DatosFaq }) {
  const router = useRouter();
  const [hoja, setHoja] = useState<BorradorFaq | null>(null);
  const [pending, start] = useTransition();
  const nombreCampana = (id: string | null) => (id ? datos.campanas.find((c) => c.id === id)?.nombre ?? "Campaña" : null);

  function correr(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "No se pudo guardar.");
      else {
        if (ok) toast.success(ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        El asistente contesta con estas respuestas. Los precios no van aquí: salen de Productos.
      </p>
      {datos.puedeEditar ? (
        <Button className="h-11 w-full sm:w-auto" onClick={() => setHoja({ id: null, pregunta: "", respuesta: "", campanaId: null, activa: true })}>
          <Plus className="mr-2 h-4 w-4" /> Añadir pregunta
        </Button>
      ) : null}
      {datos.faq.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay preguntas. Empieza por las tres que más os hacen por teléfono.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {datos.faq.map((f: FaqVista, i) => (
            <li key={f.id} className={cn("flex gap-2 px-3 py-3", !f.activa && "opacity-60")}>
              {datos.puedeEditar ? (
                <BotonesOrden
                  primero={i === 0}
                  ultimo={i === datos.faq.length - 1}
                  disabled={pending}
                  onMover={(hacia) => correr(() => moverFaqAction({ id: f.id, hacia }))}
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold leading-snug">{f.pregunta}</p>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{f.respuesta}</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5">{nombreCampana(f.campanaId) ?? "Toda la empresa"}</span>
                  {!f.activa ? <span className="rounded-full bg-muted px-2 py-0.5">Apagada</span> : null}
                  {contienePrecio(f.respuesta) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground">
                      <TriangleAlert className="h-3 w-3" aria-hidden /> Lleva un precio
                    </span>
                  ) : null}
                </div>
              </div>
              {datos.puedeEditar ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={f.activa}
                    disabled={pending}
                    aria-label={f.activa ? "Apagar pregunta" : "Encender pregunta"}
                    onCheckedChange={(v) => correr(() => guardarFaqAction({ ...f, activa: v }))}
                  />
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setHoja({ ...f })} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={hoja !== null} onOpenChange={(o) => !o && setHoja(null)}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom,0px))]">
          <SheetHeader>
            <SheetTitle>{hoja?.id ? "Editar pregunta" : "Nueva pregunta"}</SheetTitle>
            <SheetDescription>Escríbela como la haría un cliente; la respuesta, como la daríais vosotros.</SheetDescription>
          </SheetHeader>
          {hoja ? (
            <div className="space-y-4 px-4 pb-2">
              <div className="space-y-1.5">
                <Label htmlFor="faq-pregunta">Pregunta</Label>
                <Input id="faq-pregunta" value={hoja.pregunta} maxLength={300} className="text-base" onChange={(e) => setHoja({ ...hoja, pregunta: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="faq-respuesta">Respuesta</Label>
                <Textarea id="faq-respuesta" rows={5} maxLength={2000} value={hoja.respuesta} className="text-base" onChange={(e) => setHoja({ ...hoja, respuesta: e.target.value })} />
                {contienePrecio(hoja.respuesta) ? (
                  <p className="flex gap-1.5 text-xs text-warning-foreground">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Lleva un precio. El asistente solo puede decir los precios de Productos: si este no
                    está allí, descartará su respuesta y pasará la conversación a una persona.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="faq-campana">Vale para</Label>
                <select
                  id="faq-campana"
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
                  value={hoja.campanaId ?? ""}
                  onChange={(e) => setHoja({ ...hoja, campanaId: e.target.value || null })}
                >
                  <option value="">Toda la empresa</option>
                  {datos.campanas.map((c) => (
                    <option key={c.id} value={c.id}>
                      Solo la campaña «{c.nombre}»
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {hoja.id ? (
                  <Button
                    variant="ghost"
                    className="h-11 text-destructive"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm("¿Borrar esta pregunta?")) return;
                      const id = hoja.id as string;
                      setHoja(null);
                      correr(() => borrarFaqAction({ id }), "Pregunta borrada");
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Borrar
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  className="h-11"
                  disabled={pending}
                  onClick={() => {
                    const b = hoja;
                    start(async () => {
                      const r = await guardarFaqAction(b);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Pregunta guardada");
                      setHoja(null);
                      router.refresh();
                    });
                  }}
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Guardar
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Documentos
// -----------------------------------------------------------------------------

type BorradorDoc = { id: string | null; titulo: string; contenido: string; activo: boolean };

function ListaDocumentos({ datos }: { datos: DatosFaq }) {
  const router = useRouter();
  const [hoja, setHoja] = useState<BorradorDoc | null>(null);
  const [pending, start] = useTransition();

  function correr(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "No se pudo guardar.");
      else {
        if (ok) toast.success(ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Textos que el asistente puede usar: zona en la que trabajáis, horarios, cómo es la
        instalación, qué incluye el mantenimiento… Entran enteros en cada respuesta, así que mejor
        cortos y al grano.
      </p>
      {datos.puedeEditar ? (
        <Button className="h-11 w-full sm:w-auto" onClick={() => setHoja({ id: null, titulo: "", contenido: "", activo: true })}>
          <Plus className="mr-2 h-4 w-4" /> Añadir documento
        </Button>
      ) : null}
      {datos.documentos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Sin documentos.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {datos.documentos.map((d: DocumentoVista, i) => (
            <li key={d.id} className={cn("flex gap-2 px-3 py-3", !d.activo && "opacity-60")}>
              {datos.puedeEditar ? (
                <BotonesOrden
                  primero={i === 0}
                  ultimo={i === datos.documentos.length - 1}
                  disabled={pending}
                  onMover={(hacia) => correr(() => moverDocumentoAction({ id: d.id, hacia }))}
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">{d.titulo}</p>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{d.contenido}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{d.contenido.length.toLocaleString("es-ES")} caracteres</p>
              </div>
              {datos.puedeEditar ? (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={d.activo}
                    disabled={pending}
                    aria-label={d.activo ? "Apagar documento" : "Encender documento"}
                    onCheckedChange={(v) => correr(() => guardarDocumentoAction({ ...d, activo: v }))}
                  />
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setHoja({ ...d })} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={hoja !== null} onOpenChange={(o) => !o && setHoja(null)}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom,0px))]">
          <SheetHeader>
            <SheetTitle>{hoja?.id ? "Editar documento" : "Nuevo documento"}</SheetTitle>
            <SheetDescription>Sin precios: los precios salen de Productos.</SheetDescription>
          </SheetHeader>
          {hoja ? (
            <div className="space-y-4 px-4 pb-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-titulo">Título</Label>
                <Input id="doc-titulo" value={hoja.titulo} maxLength={120} className="text-base" onChange={(e) => setHoja({ ...hoja, titulo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-contenido">Texto</Label>
                <Textarea id="doc-contenido" rows={10} maxLength={20000} value={hoja.contenido} className="text-base" onChange={(e) => setHoja({ ...hoja, contenido: e.target.value })} />
                <p className="text-right text-xs tabular-nums text-muted-foreground">{hoja.contenido.length.toLocaleString("es-ES")} / 20.000</p>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {hoja.id ? (
                  <Button
                    variant="ghost"
                    className="h-11 text-destructive"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm("¿Borrar este documento?")) return;
                      const id = hoja.id as string;
                      setHoja(null);
                      correr(() => borrarDocumentoAction({ id }), "Documento borrado");
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Borrar
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  className="h-11"
                  disabled={pending}
                  onClick={() => {
                    const b = hoja;
                    start(async () => {
                      const r = await guardarDocumentoAction(b);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Documento guardado");
                      setHoja(null);
                      router.refresh();
                    });
                  }}
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Guardar
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Chat de prueba
// -----------------------------------------------------------------------------

interface LineaChat {
  rol: "contacto" | "asistente";
  texto: string;
  /** Solo en las del asistente: qué ha pasado por debajo. */
  nota?: string | null;
  herramientas?: string[];
}

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  marcar_interes: "Marcar interés",
  pedir_llamada: "Pedir llamada",
  pasar_a_persona: "Pasar a persona",
};

function ChatPrueba({ datos }: { datos: DatosFaq }) {
  const [campana, setCampana] = useState<string>(datos.campanas[0]?.id ?? "");
  const [lineas, setLineas] = useState<LineaChat[]>([]);
  const [texto, setTexto] = useState("");
  const [pending, start] = useTransition();
  const fondo = useRef<HTMLDivElement>(null);

  if (!datos.puedeEditar) {
    return <p className="text-sm text-muted-foreground">El chat de prueba es para el administrador y los directores.</p>;
  }
  if (!datos.ia.hayClave) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Falta la clave de Anthropic en el servidor: el asistente no puede contestar todavía.
      </p>
    );
  }

  function enviar() {
    const t = texto.trim();
    if (!t || pending) return;
    const historial: LineaChat[] = [...lineas, { rol: "contacto", texto: t }];
    setLineas(historial);
    setTexto("");
    start(async () => {
      const r = await probarAsistenteAction({
        campanaId: campana || null,
        mensajes: historial.map((l) => ({ rol: l.rol, texto: l.texto })),
      });
      if (!r.ok) {
        toast.error(r.error);
        setLineas(historial.slice(0, -1));
        setTexto(t);
        return;
      }
      const res = r.resultado;
      const tokens = res.tokens ? `${res.tokens.entrada + res.tokens.cacheLectura + res.tokens.cacheEscritura} de entrada (${res.tokens.cacheLectura} en caché) · ${res.tokens.salida} de salida` : null;
      setLineas([
        ...historial,
        {
          rol: "asistente",
          texto: res.texto ?? "(No contesta nada)",
          nota: [res.detalle, tokens ? `Tokens: ${tokens}` : null].filter(Boolean).join(" · ") || null,
          herramientas: res.herramientas.map((h) => (h.nombre === "marcar_interes" ? `${NOMBRE_HERRAMIENTA[h.nombre]} (nivel ${h.nivel})` : NOMBRE_HERRAMIENTA[h.nombre] ?? h.nombre)),
        },
      ]);
      requestAnimationFrame(() => fondo.current?.scrollIntoView({ block: "end" }));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
        <Bot className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Escribe como si fueras un negocio. Usa el mismo prompt y las mismas reglas que en WhatsApp,
          pero no manda nada a nadie. Cada respuesta cuesta unos céntimos.
          {!datos.ia.activa ? " El asistente está apagado en WhatsApp; aquí se puede probar igual." : ""}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="Campaña"
          className="h-11 flex-1 rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          value={campana}
          disabled={pending}
          onChange={(e) => {
            setCampana(e.target.value);
            setLineas([]);
          }}
        >
          <option value="">Sin campaña (sin equipos)</option>
          {datos.campanas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <Button variant="outline" className="h-11" disabled={pending || lineas.length === 0} onClick={() => setLineas([])}>
          <RotateCcw className="mr-2 h-4 w-4" /> Empezar de nuevo
        </Button>
      </div>

      <div className="max-h-[55dvh] min-h-48 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-muted/30 px-3 py-3">
        {lineas.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Prueba con «¿Cuánto cuesta?» o «¿Hacéis el mantenimiento?».</p>
        ) : null}
        {lineas.map((l, i) => (
          <div key={i} className={cn("flex", l.rol === "asistente" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug shadow-sm",
                l.rol === "asistente" ? "rounded-br-md bg-primary/10" : "rounded-bl-md border border-border bg-background",
              )}
            >
              {l.rol === "asistente" ? (
                <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IA</p>
              ) : null}
              <p className="whitespace-pre-wrap break-words">{l.texto}</p>
              {l.herramientas && l.herramientas.length > 0 ? (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Wrench className="h-3 w-3" aria-hidden /> {l.herramientas.join(" · ")}
                </p>
              ) : null}
              {l.nota ? <p className="mt-1 text-xs text-muted-foreground">{l.nota}</p> : null}
            </div>
          </div>
        ))}
        {pending ? (
          <p className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </p>
        ) : null}
        <div ref={fondo} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe como el negocio"
          aria-label="Mensaje de prueba"
          rows={1}
          maxLength={1500}
          className="max-h-40 min-h-11 flex-1 resize-none text-base"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={pending || texto.trim() === ""} aria-label="Enviar">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
      </form>
    </div>
  );
}
