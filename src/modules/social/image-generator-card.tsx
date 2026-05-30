"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCcw, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
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
        <label className="text-xs font-bold uppercase text-muted-foreground">
          Prompt base (puedes editar antes de generar)
        </label>
        <Textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          rows={5}
          placeholder="Ej.: Foto editorial cuadrada de grifo cromado con cal, fondo de azulejo claro…"
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Esto es la IDEA visual base. Antes de enviar a la IA se combinará
          con el estilo, paleta y restricciones de marca (configurados en
          /configuracion/rrss).
        </p>
      </div>

      {/* Preview del prompt enriquecido */}
      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={previewPrompt}
          disabled={pendingPreview}
        >
          <Eye className="h-4 w-4" />
          {pendingPreview
            ? "Construyendo…"
            : enrichedPreview
              ? "Recalcular vista previa"
              : "Ver prompt enriquecido completo"}
        </Button>
        {enrichedPreview && (
          <div className="rounded-xl border bg-muted/40">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex w-full items-center justify-between p-2 text-xs font-bold uppercase text-muted-foreground"
            >
              <span>
                Prompt completo ({enrichedPreview.length} chars · ~
                {Math.round(enrichedPreview.length / 4)} tokens)
              </span>
              {showPreview ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {showPreview && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t p-3 text-xs font-mono">
                {enrichedPreview}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Generar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="text-xs text-muted-foreground">
          {providerConfigured ? (
            <>
              Consumo mes: <strong>{used}</strong> imágenes (
              {usedEur.toFixed(2)} €) / {budgetEur.toFixed(2)} €.
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
          disabled={pendingGen || !providerConfigured || capReached}
          variant={currentImageUrl ? "outline" : "default"}
        >
          {currentImageUrl ? (
            <>
              <RefreshCcw className="h-4 w-4" />
              {pendingGen ? "Regenerando…" : "Regenerar imagen"}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {pendingGen ? "Generando…" : "Generar imagen con IA"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
