"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera, Trash2, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  uploadContractPhotoAction,
  listContractPhotos,
  deleteContractPhotoSafeAction,
  type ContractPhoto,
  type ContractPhotoKind,
} from "./photo-actions";

const KIND_LABEL: Record<ContractPhotoKind, string> = {
  id_card: "DNI",
  other: "Otro",
};

export function ContractPhotosCard({ contractId }: { contractId: string }) {
  const [photos, setPhotos] = useState<ContractPhoto[]>([]);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickedKind, setPickedKind] = useState<ContractPhotoKind>("id_card");
  const ask = useConfirm();

  useEffect(() => {
    listContractPhotos(contractId)
      .then(setPhotos)
      .catch(() => {});
  }, [contractId]);

  function pick(kind: ContractPhotoKind) {
    setPickedKind(kind);
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("contract_id", contractId);
    fd.append("kind", pickedKind);
    startTransition(async () => {
      const r = await uploadContractPhotoAction(fd);
      if (!r.ok) {
        notify.error("No se pudo subir", r.error);
        return;
      }
      setPhotos((cur) => [r.photo, ...cur]);
      notify.success("Foto subida");
    });
    e.target.value = "";
  }

  async function remove(id: string) {
    const ok = await ask({
      message: "¿Eliminar esta foto?",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteContractPhotoSafeAction(id);
      if (!r.ok) {
        notify.error("No se pudo borrar", r.error);
        return;
      }
      setPhotos((cur) => cur.filter((p) => p.id !== id));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Fotos del contrato ({photos.length})</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_LABEL) as ContractPhotoKind[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant="outline"
                onClick={() => pick(k)}
                disabled={pending}
                className="gap-1"
              >
                <Camera className="h-4 w-4" /> {KIND_LABEL[k]}
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <Plus className="h-8 w-8 opacity-50" />
            Pulsa <strong>Cámara</strong> en el botón correspondiente para sacar foto del DNI
            del cliente. Las firmas se capturan en el bloque «Firmas».
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <div
                key={p.id}
                className="relative aspect-[3/4] overflow-hidden rounded-xl border"
              >
                {p.signed_url && (
                  <Image
                    src={p.signed_url}
                    alt={KIND_LABEL[p.kind as ContractPhotoKind] ?? p.kind}
                    fill
                    sizes="(max-width:768px) 50vw, 25vw"
                    className="object-cover"
                  />
                )}
                <span className="absolute top-1 left-1 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                  {KIND_LABEL[p.kind as ContractPhotoKind] ?? p.kind}
                </span>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
                  aria-label="Eliminar"
                  disabled={pending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFile}
        />
      </CardContent>
    </Card>
  );
}
