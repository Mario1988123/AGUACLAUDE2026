"use client";

import { useId, useState, useTransition } from "react";
import { Sparkles, RefreshCcw, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  generatePostImageAction,
  previewEnrichedPromptAction,
} from "./image-generation-actions";

interface Props {
  postId: string;
  topic: string;
  baseImagePrompt: string | null;
  imageFormat: string | null;
  imageAltText: string | null;
  currentImageUrl: string | null;
  generatedAt: string | null;
  generationCostCents: number | null;
  imagesUsedThisMonth: number;
  monthlyBudgetCents: number;
  providerConfigured: boolean;
}

/**
 * Tarjeta de imagen del post: muestra la imagen actual (si existe), permite
 * editar el prompt base, previsualizar el prompt enriquecido (combinado con
 * los settings de marca) antes de gastar, y generar/regenerar.
 */
export function SocialImageGeneratorCard({
  postId,
  topic,
  baseImagePrompt,
  imageFormat,
  imageAltText,
  currentImageUrl,
  generatedAt,
  generationCostCents,
  imagesUsedThisMonth,
  monthlyBudgetCents,
  providerConfigured,
}: Props) {
  const reactId = useId();
  const promptId = `${reactId}-prompt`;
  const promptHelpId = `${reactId}-prompt-help`;
  const [promptOverride, setPromptOverride] = useState(baseImagePrompt ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [enrichedPreview, setEnrichedPreview] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [pendingGen, startGen] = useTransition();

  const used = imagesUsedThisMonth ?? 0;
  const budgetEur = (monthlyBudgetCents ?? 500) / 100;
  const usedEur = (used * 4) / 100;
  const remainingEur = budgetEur - usedEur;
  const capReached = remainingEur < 0.04;

  function previewPrompt() {
    startPreview(async () => {
      const r = await previewEnrichedPromptAction(postId, promptOverride);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setEnrichedPreview(r.prompt);
      setShowPreview(true);
    });
  }

  function generate() {
    if (capReached) {
      notify.warning(
        "Tope mensual alcanzado",
        "Sube el presupuesto en /configuracion/rrss o espera al próximo mes.",
      );
      return;
    }
    startGen(async () => {
      const r = await generatePostImageAction(postId, promptOverride);
      if (!r.ok) {
        notify.error("Error generando imagen", r.error);
        return;
      }
      notify.success(
        "Imagen generada",
        `Coste ${(r.cost_cents / 100).toFixed(2)} € · ${r.images_used} usadas este mes`,
      );
      // Recarga para mostrar la imagen nueva
      location.reload();
    });
  }

  const formatLabel = imageFormat ?? "1080x1080";

  return (
    <div className="space-y-4">
      {/* Imagen actual */}
      {currentImageUrl ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentImageUrl}
            alt={imageAltText ?? topic}
            className="max-w-full rounded-xl border"
          />
          {generatedAt && (
            <div className="text-xs text-muted-foreground">
              Generada {new Date(generatedAt).toLocaleString("es-ES")}
              {generationCostCents != null && (
                <> · coste {(generationCostCents / 100).toFixed(2)} €</>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aún no se ha generado imagen para este post.
        </div>
      )}

      {/* Metadatos */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">Formato {formatLabel}</Badge>
        {imageAltText && (
          <Badge variant="outline">Alt: {imageAltText.slice(0, 50)}…</Badge>
        )}
      </div>

      {/* Prompt base editable */}
      <div className="space-y-2">
        <Label htmlFor={promptId} className="text-xs font-bold uppercase text-muted-foreground">
          Prompt base (puedes editar antes de generar)
        </Label>
        <Textarea
          id={promptId}
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          rows={5}
          placeholder="Ej.: Foto editorial cuadrada de grifo cromado con cal, fondo de azulejo claro…"
          className="font-mono text-xs"
          aria-describedby={promptHelpId}
        />
        <p id={promptHelpId} className="text-[11px] text-muted-foreground">
          Esto es la IDEA visual base. Antes de enviar a la IA se combinará
          con el estilo, paleta y restricciones de marca (configurados en
          /configuracion/rrss).
        </p>
      </div>

      {/* Preview del prompt enriquecido — secundario, link-style */}
      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={previewPrompt}
          loading={pendingPreview}
          loadingText="Construyendo…"
          className="text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          {enrichedPreview ? "Recalcular vista previa" : "Ver prompt enriquecido completo"}
        </Button>
        {enrichedPreview && (
          <div className="rounded-xl border bg-muted/40">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
              aria-controls={`${reactId}-pre`}
              className="flex w-full items-center justify-between p-2 text-xs font-bold uppercase text-muted-foreground"
            >
              <span className="truncate text-left">
                Prompt completo ({enrichedPreview.length} chars · ~
                {Math.round(enrichedPreview.length / 4)} tokens)
              </span>
              {showPreview ? (
                <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
            </button>
            {showPreview && (
              <pre
                id={`${reactId}-pre`}
                className="max-h-64 overflow-auto whitespace-pre-wrap border-t p-3 text-xs font-mono md:max-h-96"
              >
                {enrichedPreview}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Generar — CTA primaria, móvil full-width, consumo arriba */}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground sm:max-w-[60%]">
          {providerConfigured ? (
            <>
              Consumo mes: <strong className="tabular-nums">{used}</strong> imágenes (
              <span className="tabular-nums">{usedEur.toFixed(2)} €</span>) /{" "}
              <span className="tabular-nums">{budgetEur.toFixed(2)} €</span>.
              {capReached && (
                <span className="ml-1 font-bold text-rose-700">
                  Tope alcanzado.
                </span>
              )}
            </>
          ) : (
            <span className="font-bold text-amber-800">
              Sin proveedor configurado. Ve a /configuracion/rrss.
            </span>
          )}
        </div>
        <Button
          onClick={generate}
          loading={pendingGen}
          loadingText={currentImageUrl ? "Regenerando…" : "Generando…"}
          disabled={!providerConfigured || capReached}
          variant={currentImageUrl ? "outline" : "default"}
          size="lg"
          className="w-full sm:w-auto"
        >
          {currentImageUrl ? (
            <>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Regenerar imagen
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generar imagen con IA
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
