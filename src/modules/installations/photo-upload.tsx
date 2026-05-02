"use client";

import { useState, useRef, useTransition } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { uploadInstallationPhoto } from "./photo-actions";

const CATEGORIES: { key: string; label: string; required: boolean }[] = [
  { key: "previous_damage", label: "Daños previos", required: false },
  { key: "countertop_drilling", label: "Agujero encimera", required: false },
  { key: "equipment_location", label: "Ubicación equipo", required: true },
  { key: "network_connection", label: "Conexión red", required: true },
  { key: "before", label: "Antes", required: false },
  { key: "after", label: "Después", required: false },
  { key: "other", label: "Otra", required: false },
];

interface Props {
  installationId: string;
  existingPhotos: { id: string; category: string; storage_path: string }[];
}

export function PhotoUploadPanel({ installationId, existingPhotos }: Props) {
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("equipment_location");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      notify.warning("Archivo demasiado grande (máx 10 MB)");
      return;
    }
    startTransition(async () => {
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          await uploadInstallationPhoto({
            installation_id: installationId,
            category,
            data_url: dataUrl,
            mime_type: file.type,
          });
          notify.success("Foto subida");
          location.reload();
        };
        reader.readAsDataURL(file);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  const counts = existingPhotos.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Categoría
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`flex h-12 items-center justify-between rounded-xl border-2 px-3 text-xs font-semibold transition-colors ${
                category === c.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              <span>{c.label}</span>
              {counts[c.key] != null && counts[c.key]! > 0 ? (
                <Badge variant="success">{counts[c.key]}</Badge>
              ) : c.required ? (
                <Badge variant="warning">Pte</Badge>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />

      <Button
        onClick={pick}
        disabled={pending}
        variant="default"
        size="lg"
        className="w-full"
      >
        <Camera className="h-5 w-5" />
        {pending ? "Subiendo..." : "Tomar/elegir foto"}
      </Button>

      {existingPhotos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin fotos todavía.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {existingPhotos.map((p) => (
            <PhotoTile key={p.id} photo={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoTile({ photo }: { photo: { id: string; storage_path: string; category: string } }) {
  const [url, setUrl] = useState<string | null>(null);
  // Lazy load signed URL
  if (!url) {
    void fetch(`/api/storage/sign?path=${encodeURIComponent(photo.storage_path)}`)
      .then((r) => r.json())
      .then((d) => d.url && setUrl(d.url))
      .catch(() => {});
  }
  const cat = CATEGORIES.find((c) => c.key === photo.category)?.label ?? photo.category;
  return (
    <div className="aspect-square overflow-hidden rounded-xl border border-border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={cat} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {cat}
        </div>
      )}
    </div>
  );
}
