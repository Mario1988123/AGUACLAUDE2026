"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Save,
  RotateCcw,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Badge } from "@/shared/ui/badge";
import { Textarea } from "@/shared/ui/textarea";
import {
  updateTemplateAction,
  resetTemplateToSystemAction,
  previewTemplateHtmlAction,
  type TemplateEditData,
} from "./actions";

export function TemplateEditor({ template }: { template: TemplateEditData }) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.body_html);
  const [isActive, setIsActive] = useState(template.is_active);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [saving, startSave] = useTransition();
  const [resetting, startReset] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Preview en vivo (debounce). Re-renderiza cuando cambian asunto/cuerpo.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await previewTemplateHtmlAction({
          subject,
          body_html: bodyHtml,
          kind: template.kind,
        });
        setPreviewHtml(r.html);
        setPreviewSubject(r.subject);
      } catch {
        /* fail-soft: dejamos el preview anterior */
      }
    }, 450);
    return () => clearTimeout(t);
  }, [subject, bodyHtml, template.kind]);

  function insertVariable(v: string) {
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBodyHtml((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? bodyHtml.length;
    const end = el.selectionEnd ?? bodyHtml.length;
    const next = bodyHtml.slice(0, start) + token + bodyHtml.slice(end);
    setBodyHtml(next);
    // Reposicionar el cursor tras el token insertado.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function save() {
    setResult(null);
    startSave(async () => {
      const r = await updateTemplateAction({
        id: template.id,
        subject: subject.trim(),
        body_html: bodyHtml.trim(),
        is_active: isActive,
      });
      setResult(
        r.ok
          ? { ok: true, message: "Plantilla guardada" }
          : { ok: false, message: r.error },
      );
      if (r.ok) router.refresh();
    });
  }

  function reset() {
    if (
      !confirm(
        "¿Restaurar esta plantilla al diseño original del sistema? Se perderán tus cambios guardados.",
      )
    ) {
      return;
    }
    setResult(null);
    startReset(async () => {
      const r = await resetTemplateToSystemAction(template.id);
      if (r.ok) {
        router.refresh();
        setResult({ ok: true, message: "Plantilla restaurada al original" });
      } else {
        setResult({ ok: false, message: r.error });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{template.name}</h1>
            <Badge
              variant={template.kind === "marketing" ? "secondary" : "outline"}
            >
              {template.kind === "marketing" ? "Marketing" : "Transaccional"}
            </Badge>
            {template.is_system && <Badge variant="outline">Sistema</Badge>}
          </div>
          {template.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {template.description}
            </p>
          )}
        </div>
        <Link
          href="/configuracion/mailing"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Editor */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Asunto del email</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Asunto…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cuerpo del email (HTML)</Label>
            <Textarea
              ref={bodyRef}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              spellCheck={false}
              className="min-h-[340px] font-mono text-xs leading-relaxed"
              placeholder="<p>Hola {{customer_first_name}}…</p>"
            />
            <p className="text-xs text-muted-foreground">
              Puedes usar etiquetas HTML básicas. Las{" "}
              <span className="font-mono">{"{{variables}}"}</span> se sustituyen
              por los datos reales al enviar.
            </p>
          </div>

          {template.variables.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">
                Variables disponibles (toca para insertar)
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {template.variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 font-mono text-[11px] text-primary hover:bg-primary/10"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Plantilla activa</Label>
          </div>

          {result && (
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {result.message}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Guardar cambios
            </Button>
            {template.key && (
              <Button
                variant="outline"
                onClick={reset}
                disabled={resetting}
                className="gap-2"
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Restaurar original
              </Button>
            )}
          </div>
        </div>

        {/* Preview en vivo */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Eye className="h-4 w-4" />
            Vista previa (datos de muestra)
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b bg-amber-50/50 px-3 py-2 text-xs">
              <span className="font-bold text-amber-900">Asunto: </span>
              <span className="text-amber-900">{previewSubject || "…"}</span>
            </div>
            <iframe
              title="Vista previa"
              srcDoc={previewHtml}
              className="block w-full bg-white"
              style={{ height: 560, border: 0 }}
              sandbox=""
            />
          </div>
        </div>
      </div>
    </div>
  );
}
