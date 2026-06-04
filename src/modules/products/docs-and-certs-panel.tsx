"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  uploadProductDocumentAction,
  deleteProductDocumentAction,
  getProductDocumentUrlAction,
  type ProductDocumentItem,
} from "./documents-actions";
import {
  PRODUCT_DOC_KIND_LABEL,
  type ProductDocKind,
} from "./documents-constants";
import {
  addProductCertificationAction,
  removeProductCertificationAction,
  type CertificationCatalogItem,
  type ProductCertificationItem,
} from "./certifications-actions";

interface Props {
  productId: string;
  initialDocuments: ProductDocumentItem[];
  initialCertifications: ProductCertificationItem[];
  catalog: CertificationCatalogItem[];
  canEdit: boolean;
}

const DOC_KINDS: ProductDocKind[] = [
  "manual_user",
  "manual_installer",
  "manufacturer_datasheet",
  "certificate",
  "warranty_card",
  "compliance_doc",
  "spare_parts_list",
  "other",
];

export function DocsAndCertsPanel({
  productId,
  initialDocuments,
  initialCertifications,
  catalog,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [docs, setDocs] = useState(initialDocuments);
  const [certs, setCerts] = useState(initialCertifications);

  // Upload doc state
  const [uploadKind, setUploadKind] = useState<ProductDocKind>("manual_user");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadPublic, setUploadPublic] = useState(false);

  // Add cert state
  const [certKey, setCertKey] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [certIssued, setCertIssued] = useState("");
  const [certValid, setCertValid] = useState("");
  const [certIssuer, setCertIssuer] = useState("");

  // ===== Documentos =====
  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("product_id", productId);
    fd.set("kind", uploadKind);
    fd.set("title", uploadTitle.trim());
    if (uploadPublic) fd.set("is_public", "on");

    startTransition(async () => {
      const r = await uploadProductDocumentAction(fd);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Documento subido");
      setUploadTitle("");
      setUploadPublic(false);
      form.reset();
      router.refresh();
    });
  }

  function handleDeleteDoc(id: string) {
    if (!confirm("¿Borrar este documento?")) return;
    startTransition(async () => {
      const r = await deleteProductDocumentAction(id, productId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setDocs((d) => d.filter((x) => x.id !== id));
      notify.success("Documento borrado");
    });
  }

  function handleOpenDoc(id: string) {
    startTransition(async () => {
      const r = await getProductDocumentUrlAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  // ===== Certificaciones =====
  function handleAddCert() {
    if (!certKey) {
      notify.error("Selecciona una certificación del catálogo");
      return;
    }
    startTransition(async () => {
      const r = await addProductCertificationAction({
        productId,
        certificationKey: certKey,
        certificateNumber: certNumber.trim() || null,
        issuedAt: certIssued || null,
        validUntil: certValid || null,
        issuerName: certIssuer.trim() || null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Certificación añadida");
      setCertKey("");
      setCertNumber("");
      setCertIssued("");
      setCertValid("");
      setCertIssuer("");
      router.refresh();
    });
  }

  function handleRemoveCert(id: string) {
    if (!confirm("¿Quitar esta certificación?")) return;
    startTransition(async () => {
      const r = await removeProductCertificationAction(id, productId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setCerts((c) => c.filter((x) => x.id !== id));
      notify.success("Certificación eliminada");
    });
  }

  const usedCertKeys = new Set(certs.map((c) => c.certification_key));
  const availableCerts = catalog.filter((c) => !usedCertKeys.has(c.key));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* DOCUMENTOS */}
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Documentos ({docs.length})
        </h3>

        {canEdit && (
          <form onSubmit={handleUpload} className="space-y-2 rounded-xl bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <select
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value as ProductDocKind)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {DOC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PRODUCT_DOC_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Título *</Label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Manual instalación v2"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Archivo (PDF/DOCX/PNG, máx 25 MB)</Label>
              <input
                type="file"
                name="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                className="block w-full text-xs"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={uploadPublic}
                onChange={(e) => setUploadPublic(e.target.checked)}
              />
              Mostrar en la página pública del producto
            </label>
            <Button type="submit" disabled={pending || !uploadTitle.trim()}>
              {pending ? "Subiendo..." : "Subir documento"}
            </Button>
          </form>
        )}

        {docs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin documentos.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{d.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {PRODUCT_DOC_KIND_LABEL[d.kind]}
                    {d.is_public && " · Público"}
                    {d.file_size_bytes != null &&
                      ` · ${(d.file_size_bytes / 1024).toFixed(0)} KB`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenDoc(d.id)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Abrir
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDoc(d.id)}
                      className="text-xs font-semibold text-red-600 hover:underline"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CERTIFICACIONES */}
      <div className="space-y-3 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Certificaciones ({certs.length})
        </h3>

        {canEdit && (
          <div className="space-y-2 rounded-xl bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Certificación del catálogo</Label>
                <select
                  value={certKey}
                  onChange={(e) => setCertKey(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— Selecciona —</option>
                  {availableCerts.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name_es}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nº de certificado</Label>
                <Input value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Emisor</Label>
                <Input value={certIssuer} onChange={(e) => setCertIssuer(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Emitido</Label>
                <Input
                  type="date"
                  value={certIssued}
                  onChange={(e) => setCertIssued(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Válido hasta</Label>
                <Input
                  type="date"
                  value={certValid}
                  onChange={(e) => setCertValid(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={handleAddCert} disabled={pending || !certKey}>
              {pending ? "Añadiendo..." : "Añadir certificación"}
            </Button>
          </div>
        )}

        {certs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin certificaciones.</p>
        ) : (
          <ul className="space-y-2">
            {certs.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name_es}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.certificate_number ? `Nº ${c.certificate_number}` : ""}
                    {c.valid_until ? ` · válido hasta ${c.valid_until}` : ""}
                    {c.issuer_name ? ` · ${c.issuer_name}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCert(c.id)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
