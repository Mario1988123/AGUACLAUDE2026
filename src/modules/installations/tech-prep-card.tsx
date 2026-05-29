"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Upload, Trash2, Save, Loader2, Video, ImageIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createClient } from "@/shared/lib/supabase/client";
import { compressImage, compressVideo, getVideoDuration } from "./media-compress";
import {
  saveTechPrepNotes,
  createTechPrepUploadUrl,
  registerTechPrepMedia,
  deleteTechPrepMedia,
  type TechPrepMedia,
} from "./tech-prep-actions";

const BUCKET = "installation-photos";
const MAX_VIDEO_SECONDS = 30;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function TechPrepCard({
  contractId,
  initialNotes,
  initialMedia,
  canEdit,
}: {
  contractId: string;
  initialNotes: string;
  initialMedia: TechPrepMedia[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [media, setMedia] = useState<TechPrepMedia[]>(initialMedia);
  const [savingNotes, startSaveNotes] = useTransition();
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function saveNotes() {
    startSaveNotes(async () => {
      const r = await saveTechPrepNotes(contractId, notes);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Notas guardadas");
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permitir re-seleccionar el mismo fichero
    if (!file) return;
    setBusy(true);
    try {
      const isVideo = file.type.startsWith("video/");
      let toUpload = file;

      if (isVideo) {
        setBusyMsg("Comprobando vídeo…");
        const dur = await getVideoDuration(file);
        if (dur > MAX_VIDEO_SECONDS + 0.5) {
          notify.error("Vídeo demasiado largo", `Máximo ${MAX_VIDEO_SECONDS} segundos.`);
          return;
        }
        setBusyMsg("Comprimiendo vídeo…");
        toUpload = await compressVideo(file);
        if (toUpload.size > MAX_VIDEO_BYTES) {
          notify.error(
            "Vídeo demasiado pesado",
            "No se pudo reducir por debajo de 25 MB. Graba un clip más corto o con menos calidad.",
          );
          return;
        }
      } else if (file.type.startsWith("image/")) {
        setBusyMsg("Comprimiendo foto…");
        toUpload = await compressImage(file);
        if (toUpload.size > MAX_IMAGE_BYTES) {
          notify.error("Imagen demasiado pesada", "Máximo 10 MB.");
          return;
        }
      } else {
        notify.error("Formato no admitido", "Solo fotos o vídeos.");
        return;
      }

      setBusyMsg("Subiendo…");
      const ext = (toUpload.type.split("/")[1] || "bin").replace("jpeg", "jpg");
      const urlRes = await createTechPrepUploadUrl(contractId, ext);
      if (!urlRes.ok) {
        notify.error("No se pudo subir", urlRes.error);
        return;
      }
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(urlRes.path, urlRes.token, toUpload);
      if (upErr) {
        notify.error("Error subiendo a almacenamiento", upErr.message);
        return;
      }
      const reg = await registerTechPrepMedia(contractId, {
        storage_path: urlRes.path,
        mime_type: toUpload.type,
        size_bytes: toUpload.size,
      });
      if (!reg.ok) {
        notify.error("No se pudo registrar", reg.error);
        return;
      }
      notify.success(isVideo ? "Vídeo añadido" : "Foto añadida");
      router.refresh();
    } catch (err) {
      notify.error("Error", err instanceof Error ? err.message : "desconocido");
    } finally {
      setBusy(false);
      setBusyMsg("");
    }
  }

  function remove(id: string) {
    if (!confirm("¿Eliminar este archivo?")) return;
    setBusy(true);
    (async () => {
      const r = await deleteTechPrepMedia(id);
      setBusy(false);
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      setMedia((m) => m.filter((x) => x.id !== id));
      notify.success("Eliminado");
    })();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" /> Instrucciones para el técnico
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Notas, fotos y vídeos (máx. {MAX_VIDEO_SECONDS}s) del sitio para que el
          técnico sepa qué material necesita. {canEdit ? "" : "(Solo lectura)"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={!canEdit}
            rows={4}
            placeholder="Ej: cocina con encimera de granito, necesita taladro especial; toma de agua bajo el fregadero a la izquierda; añadir codo extra…"
            className="w-full rounded-xl border border-input bg-background p-3 text-sm disabled:opacity-60"
          />
          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={saveNotes} disabled={savingNotes} size="sm" variant="success" className="gap-2">
                <Save className="h-4 w-4" />
                {savingNotes ? "Guardando…" : "Guardar notas"}
              </Button>
            </div>
          )}
        </div>

        {media.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {media.map((m) => (
              <div key={m.id} className="relative overflow-hidden rounded-xl border bg-muted/20">
                {m.is_video ? (
                  m.url ? (
                    <video src={m.url} controls className="h-32 w-full object-cover" />
                  ) : (
                    <div className="flex h-32 items-center justify-center text-muted-foreground">
                      <Video className="h-6 w-6" />
                    </div>
                  )
                ) : m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    disabled={busy}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={onFile}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {busyMsg || "Procesando…"}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Añadir foto o vídeo
                </>
              )}
            </Button>
          </div>
        )}

        {media.length === 0 && !canEdit && (
          <p className="text-sm text-muted-foreground">Sin material adjunto.</p>
        )}
      </CardContent>
    </Card>
  );
}
