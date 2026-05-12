"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, Trash2, ImageIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { uploadCompanyLogoAction } from "./actions";

/** 1 MB (mismo límite que el server). */
const MAX_BYTES = 1 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/svg+xml";

/**
 * Subida del logo de empresa. Valida en cliente (tipo y tamaño) antes de
 * mandar al servidor — feedback inmediato y ahorra ancho de banda. Tras
 * subir, llama a `onUploaded(url)` para que el form que lo contiene
 * persista esa URL en `fiscal_logo_url` al guardar.
 */
export function LogoUploader({
  currentUrl,
  onUploaded,
  onCleared,
}: {
  currentUrl: string | null;
  onUploaded: (url: string) => void;
  onCleared: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      notify.error("Tipo no soportado", "Sube un PNG, JPG, WEBP o SVG.");
      return;
    }
    if (file.size > MAX_BYTES) {
      notify.error(
        "Logo demasiado grande",
        `${(file.size / 1024 / 1024).toFixed(2)} MB · máximo 1 MB. Comprímelo o reduce dimensiones.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      notify.error("Error al leer el archivo", "Intenta con otro archivo.");
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      // Si es raster, mostramos la dimensión natural para que el usuario
      // sepa si el logo es muy pequeño para imprimir bien.
      if (!file.type.includes("svg")) {
        const probe = new window.Image();
        probe.onload = () => {
          setNaturalSize({ w: probe.naturalWidth, h: probe.naturalHeight });
        };
        probe.src = dataUrl;
      } else {
        setNaturalSize(null);
      }
      startTransition(async () => {
        try {
          const r = await uploadCompanyLogoAction({
            data_url: dataUrl,
            original_filename: file.name,
          });
          onUploaded(r.url);
          notify.success("Logo subido", "Recuerda «Guardar» para conservar el cambio.");
        } catch (err) {
          notify.error(
            "No se pudo subir",
            err instanceof Error ? err.message : String(err),
          );
        }
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-32 w-48 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Logo empresa"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={pickFile}
              disabled={pending}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {pending
                ? "Subiendo..."
                : currentUrl
                  ? "Cambiar logo"
                  : "Subir logo"}
            </Button>
            {currentUrl && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onCleared();
                  setNaturalSize(null);
                }}
                disabled={pending}
                className="text-destructive gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Quitar
              </Button>
            )}
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-0.5 leading-tight">
            <li>
              <strong>Formato:</strong> PNG · JPG · WEBP · SVG
            </li>
            <li>
              <strong>Tamaño máximo:</strong> 1 MB
            </li>
            <li>
              <strong>Dimensiones recomendadas:</strong> 600 – 1200 px de ancho
              (≈ 4 – 6 cm a 300 dpi). Aspect-ratio se mantiene en el PDF.
            </li>
            {naturalSize && (
              <li className="font-semibold">
                Dimensión del archivo: {naturalSize.w} × {naturalSize.h} px
                {naturalSize.w < 400 && (
                  <span className="ml-1 text-amber-600">
                    (muy pequeño — el logo se verá pixelado al imprimir)
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          // Reset para permitir subir el mismo archivo dos veces seguidas
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
