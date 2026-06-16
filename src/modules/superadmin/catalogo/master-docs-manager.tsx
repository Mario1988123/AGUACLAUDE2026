"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  PRODUCT_DOC_KIND_LABEL,
  type ProductDocKind,
} from "@/modules/products/documents-constants";
import {
  uploadCatalogDocumentAction,
  deleteCatalogDocumentSafeAction,
  getCatalogFileUrlAction,
  type CatalogDoc,
} from "./master-products-actions";

const KINDS = Object.keys(PRODUCT_DOC_KIND_LABEL) as ProductDocKind[];

export function MasterDocsManager({
  productId,
  documents,
}: {
  productId: string;
  documents: CatalogDoc[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ProductDocKind>("manufacturer_datasheet");
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!title.trim()) {
      notify.warning("Pon un título antes de elegir el archivo");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const fd = new FormData();
    fd.set("catalog_product_id", productId);
    fd.set("kind", kind);
    fd.set("title", title.trim());
    fd.set("file", file);
    startTransition(async () => {
      const r = await uploadCatalogDocumentAction(fd);
      if (!r.ok) notify.error("No se pudo subir", r.error);
      else {
        notify.success("Documento añadido");
        setTitle("");
        router.refresh();
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function download(d: CatalogDoc) {
    startTransition(async () => {
      const r = await getCatalogFileUrlAction(d.storage_path);
      if (!r.ok) notify.error("Error", r.error);
      else window.open(r.url, "_blank");
    });
  }

  async function del(d: CatalogDoc) {
    const ok = await confirm({
      title: "Borrar documento",
      message: `¿Borrar "${d.title}"?`,
      confirmText: "Borrar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteCatalogDocumentSafeAction(d.id, productId);
      if (!r.ok) notify.error("Error", r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold">Documentación</h3>

      <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ProductDocKind)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {PRODUCT_DOC_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Manual de usuario…" />
        </div>
        <Button variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" /> Subir
        </Button>
        <input ref={inputRef} type="file" hidden onChange={onFile} />
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin documentos todavía.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{d.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {PRODUCT_DOC_KIND_LABEL[d.kind]}
                </div>
              </div>
              <button
                type="button"
                onClick={() => download(d)}
                disabled={pending}
                title="Descargar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => del(d)}
                disabled={pending}
                title="Borrar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-100 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
