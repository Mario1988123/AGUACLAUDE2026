"use client";

import { useState, useTransition } from "react";
import {
  Sparkles,
  RefreshCcw,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { ImageGeneratorModal } from "./image-generator-modal";
import { previewEnrichedPromptAction } from "./image-generation-actions";
import type { ImageOverrides, ImageVisualSettings } from "./image-types";

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
  // Nuevo: defaults completos + estado guardado del post
  defaults: ImageVisualSettings;
  initialOverrides: ImageOverrides | null;
  initialProductIds: string[];
  hasFiscalLogo: boolean;
}

/**
 * Tarjeta de imagen del post: muestra la imagen actual (si existe) y un botón
 * que abre el modal de generación con todas las opciones (estilo, marca,
 * productos, preview). Toda la lógica pesada vive en image-generator-modal.
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
  defaults,
  initialOverrides,
  initialProductIds,
  hasFiscalLogo,
}: Props) {
  const [open, setOpen] = useState(false);
  const [enrichedPreview, setEnrichedPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingPreview, startPreview] = useTransition();
  const budgetEur = (monthlyBudgetCents ?? 500) / 100;
  const usedEur = ((imagesUsedThisMonth ?? 0) * 4) / 100;
  const remainingEur = budgetEur - usedEur;
  const capReached = remainingEur < 0.04;
  const formatLabel = imageFormat ?? "1080x1080";

  function previewPrompt() {
    startPreview(async () => {
      const r = await previewEnrichedPromptAction(
        postId,
        baseImagePrompt ?? undefined,
        initialOverrides,
        initialProductIds,
      );
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setEnrichedPreview(r.prompt);
      setShowPreview(true);
    });
  }

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
        {initialProductIds.length > 0 && (
          <Badge variant="secondary">
            {initialProductIds.length} producto
            {initialProductIds.length === 1 ? "" : "s"} vinculado
            {initialProductIds.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {/* Vista previa rápida del prompt enriquecido (sin abrir el modal) */}
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
          {enrichedPreview
            ? "Recalcular prompt enriquecido"
            : "Ver prompt enriquecido completo"}
        </Button>
        {enrichedPreview && (
          <div className="rounded-xl border bg-muted/40">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
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
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t p-3 text-xs font-mono md:max-h-96">
                {enrichedPreview}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Estado consumo + CTA */}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground sm:max-w-[60%]">
          {providerConfigured ? (
            <>
              Consumo mes:{" "}
              <strong className="tabular-nums">{imagesUsedThisMonth}</strong>{" "}
              imágenes (
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
          onClick={() => setOpen(true)}
          disabled={!providerConfigured || capReached}
          variant={currentImageUrl ? "outline" : "default"}
          size="lg"
          className="w-full sm:w-auto"
        >
          {currentImageUrl ? (
            <>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Regenerar imagen IA
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generar imagen IA
            </>
          )}
        </Button>
      </div>

      <ImageGeneratorModal
        open={open}
        onOpenChange={setOpen}
        postId={postId}
        baseImagePrompt={baseImagePrompt}
        defaults={defaults}
        initialOverrides={initialOverrides}
        initialProductIds={initialProductIds}
        capReached={capReached}
        imagesUsed={imagesUsedThisMonth}
        monthlyBudgetCents={monthlyBudgetCents}
        hasFiscalLogo={hasFiscalLogo}
        onGenerated={() => {
          // Recarga la página para mostrar la imagen nueva.
          if (typeof window !== "undefined") window.location.reload();
        }}
      />
    </div>
  );
}
