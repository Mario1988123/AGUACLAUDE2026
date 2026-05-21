"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { uploadProductPhotoSafeAction, clearProductPhotoSafeAction } from "./photo-actions";

export function ProductPhotoUploader({
  productId,
  currentUrl,
}: {
  productId: string;
  currentUrl: string | null;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function pick() {
    fileRef.current?.click();
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("product_id", productId);
    startTransition(async () => {
      const r = await uploadProductPhotoSafeAction(fd);
      if (!r.ok) {
        notify.error("Error", r.error);
        setPreview(currentUrl);
        return;
      }
      setPreview(r.url);
      notify.success("Foto subida");
      router.refresh();
    });
  }
  function clear() {
    startTransition(async () => {
      const r = await clearProductPhotoSafeAction(productId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setPreview(null);
      router.refresh();
    });
  }
  return (
    <div className="flex items-start gap-4">
      <div className="relative flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted/30">
        {preview ? (
          <Image
            src={preview}
            alt="Foto producto"
            fill
            sizes="128px"
            className="object-cover"
          />
        ) : (
          <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button onClick={pick} variant="outline" disabled={pending} className="gap-2">
          <Camera className="h-4 w-4" /> {preview ? "Cambiar foto" : "Subir foto"}
        </Button>
        {preview && (
          <Button onClick={clear} variant="ghost" disabled={pending} className="gap-2">
            <X className="h-4 w-4" /> Quitar
          </Button>
        )}
        <p className="text-xs text-muted-foreground">JPG/PNG/WebP, máx 4MB.</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFile}
      />
    </div>
  );
}
