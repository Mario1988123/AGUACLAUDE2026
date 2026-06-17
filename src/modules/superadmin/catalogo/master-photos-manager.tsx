"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  uploadCatalogPhotoAction,
  deleteCatalogPhotoSafeAction,
  setMainCatalogPhotoSafeAction,
  type CatalogPhoto,
} from "./master-products-actions";

export function MasterPhotosManager({
  productId,
  photos,
}: {
  productId: string;
  photos: CatalogPhoto[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Control de tamaño ANTES de enviar: por encima del límite del servidor la
    // llamada lanzaría una excepción que tumbaría la página entera.
    if (file.size > 8 * 1024 * 1024) {
      notify.warning("Imagen demasiado grande", "Máximo 8 MB. Reduce o recorta la foto.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const fd = new FormData();
    fd.set("catalog_product_id", productId);
    fd.set("file", file);
    startTransition(async () => {
      try {
        const r = await uploadCatalogPhotoAction(fd);
        if (!r.ok) notify.error("No se pudo subir", r.error);
        else {
          notify.success("Foto añadida");
          router.refresh();
        }
      } catch {
        notify.error("No se pudo subir la foto", "Prueba con una imagen más pequeña.");
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function setMain(id: string) {
    startTransition(async () => {
      const r = await setMainCatalogPhotoSafeAction(id, productId);
      if (!r.ok) notify.error("Error", r.error);
      else router.refresh();
    });
  }

  async function del(id: string) {
    const ok = await confirm({
      title: "Borrar foto",
      message: "¿Seguro que quieres borrar esta foto?",
      confirmText: "Borrar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteCatalogPhotoSafeAction(id, productId);
      if (!r.ok) notify.error("Error", r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Fotos</h3>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" /> Subir foto
        </Button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin fotos todavía.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="relative rounded-xl border bg-muted/20 p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url ?? ""}
                alt=""
                className="h-28 w-full rounded-lg object-contain"
              />
              {p.is_main && (
                <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">
                  Principal
                </span>
              )}
              <div className="mt-1 flex justify-center gap-1">
                {!p.is_main && (
                  <button
                    type="button"
                    onClick={() => setMain(p.id)}
                    disabled={pending}
                    title="Marcar como principal"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => del(p.id)}
                  disabled={pending}
                  title="Borrar"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-100 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
