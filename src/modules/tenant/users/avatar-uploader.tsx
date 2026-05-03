"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { uploadAvatarAction, clearAvatarAction } from "./avatar-actions";

export function AvatarUploader({
  currentUrl,
  fullName,
}: {
  currentUrl: string | null;
  fullName: string | null;
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
    setPreview(URL.createObjectURL(file));
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      try {
        const url = await uploadAvatarAction(fd);
        setPreview(url);
        notify.success("Avatar actualizado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
        setPreview(currentUrl);
      }
    });
  }

  function clear() {
    startTransition(async () => {
      try {
        await clearAvatarAction();
        setPreview(null);
        notify.success("Avatar eliminado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={fullName ?? "Avatar"}
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
            {(fullName ?? "?").slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="outline" onClick={pick} disabled={pending} className="gap-1">
          <Camera className="h-4 w-4" /> {pending ? "Subiendo…" : "Cambiar"}
        </Button>
        {preview && (
          <Button size="sm" variant="ghost" onClick={clear} disabled={pending} className="gap-1">
            <X className="h-4 w-4" /> Quitar
          </Button>
        )}
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
