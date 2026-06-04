"use client";
/**
 * Panel "Datos extendidos" en /productos/[id]. Permite al admin editar los
 * 14 campos nuevos añadidos en la Fase 1 del Plan Productos v2:
 *   - Marketing y comercial: marketing_claim, tags, youtube_url, qr_target_url,
 *     barcode_ean13, country_of_origin, datasheet_color_accent.
 *   - Fabricante: manufacturer_name, manufacturer_model.
 *   - Garantías: warranty_months_general/electronics/body.
 *   - Ciclo de vida: discontinued_at, replaced_by_product_id,
 *     installation_diagram_url.
 *
 * Solo se renderiza cuando canEdit=true (la ficha padre se ocupa).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateProductAction } from "./actions";

export interface ExtendedFieldsInitial {
  tags: string[] | null;
  marketing_claim: string | null;
  youtube_url: string | null;
  qr_target_url: string | null;
  barcode_ean13: string | null;
  country_of_origin: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  warranty_months_general: number | null;
  warranty_months_electronics: number | null;
  warranty_months_body: number | null;
  discontinued_at: string | null;
  replaced_by_product_id: string | null;
  installation_diagram_url: string | null;
  datasheet_color_accent: string | null;
}

interface Props {
  productId: string;
  initial: ExtendedFieldsInitial;
  /** Tags del catálogo para sugerencias y colores (opcional). */
  tagSuggestions?: Array<{ name: string; color_hex: string }>;
  /** Otros productos del catálogo para "Reemplazado por". */
  otherProducts?: Array<{ id: string; name: string }>;
}

function isValidHex(s: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(s.trim());
}

export function ExtendedFieldsPanel({
  productId,
  initial,
  tagSuggestions = [],
  otherProducts = [],
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tagsInput, setTagsInput] = useState<string>(
    (initial.tags ?? []).join(", "),
  );
  const [form, setForm] = useState({
    marketing_claim: initial.marketing_claim ?? "",
    youtube_url: initial.youtube_url ?? "",
    qr_target_url: initial.qr_target_url ?? "",
    barcode_ean13: initial.barcode_ean13 ?? "",
    country_of_origin: initial.country_of_origin ?? "",
    manufacturer_name: initial.manufacturer_name ?? "",
    manufacturer_model: initial.manufacturer_model ?? "",
    warranty_months_general:
      initial.warranty_months_general?.toString() ?? "",
    warranty_months_electronics:
      initial.warranty_months_electronics?.toString() ?? "",
    warranty_months_body: initial.warranty_months_body?.toString() ?? "",
    discontinued_at: initial.discontinued_at
      ? initial.discontinued_at.slice(0, 10)
      : "",
    replaced_by_product_id: initial.replaced_by_product_id ?? "",
    installation_diagram_url: initial.installation_diagram_url ?? "",
    datasheet_color_accent: initial.datasheet_color_accent ?? "",
  });

  function parseTags(s: string): string[] {
    return Array.from(
      new Set(
        s
          .split(/[,;\n]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && t.length <= 60),
      ),
    );
  }

  function save() {
    if (
      form.datasheet_color_accent.trim() !== "" &&
      !isValidHex(form.datasheet_color_accent.trim())
    ) {
      notify.error(
        "Color no válido",
        "Usa formato hexadecimal de 6 dígitos (ej. #4880FF). Déjalo vacío para usar el color de la empresa.",
      );
      return;
    }
    if (
      form.country_of_origin.trim() !== "" &&
      form.country_of_origin.trim().length !== 2
    ) {
      notify.error(
        "País de origen no válido",
        "Usa el código de 2 letras (ej. ES para España, IT para Italia).",
      );
      return;
    }

    startTransition(async () => {
      const r = await updateProductAction(productId, {
        tags: parseTags(tagsInput),
        marketing_claim: form.marketing_claim.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
        qr_target_url: form.qr_target_url.trim() || null,
        barcode_ean13: form.barcode_ean13.trim() || null,
        country_of_origin: form.country_of_origin.trim().toUpperCase() || null,
        manufacturer_name: form.manufacturer_name.trim() || null,
        manufacturer_model: form.manufacturer_model.trim() || null,
        warranty_months_general: form.warranty_months_general
          ? Number(form.warranty_months_general)
          : null,
        warranty_months_electronics: form.warranty_months_electronics
          ? Number(form.warranty_months_electronics)
          : null,
        warranty_months_body: form.warranty_months_body
          ? Number(form.warranty_months_body)
          : null,
        discontinued_at: form.discontinued_at
          ? new Date(form.discontinued_at).toISOString()
          : null,
        replaced_by_product_id: form.replaced_by_product_id || null,
        installation_diagram_url: form.installation_diagram_url.trim() || null,
        datasheet_color_accent:
          form.datasheet_color_accent.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudieron guardar los datos extendidos", r.error);
        return;
      }
      notify.success("Datos guardados");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* === MARKETING Y COMERCIAL === */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Marketing y comercial
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Frase comercial destacada (máx. 120 caracteres)</Label>
            <Input
              maxLength={120}
              value={form.marketing_claim}
              onChange={(e) =>
                setForm((f) => ({ ...f, marketing_claim: e.target.value }))
              }
              placeholder="Hasta 50% menos consumo de sal"
            />
            <p className="text-[11px] text-muted-foreground">
              Aparece grande en la ficha técnica y en el catálogo.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Tags (separados por comas)</Label>
            <textarea
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="min-h-[60px] w-full rounded-xl border border-input bg-background p-3 text-sm"
              placeholder="bestseller, horeca, promo-junio"
            />
            {tagSuggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                <span className="text-[11px] text-muted-foreground">
                  Del catálogo:
                </span>
                {tagSuggestions.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      const current = parseTags(tagsInput);
                      if (!current.includes(t.name)) {
                        setTagsInput([...current, t.name].join(", "));
                      }
                    }}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-semibold hover:bg-muted"
                    style={{
                      borderColor: `${t.color_hex}55`,
                      color: t.color_hex,
                    }}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Vídeo (YouTube)</Label>
            <Input
              value={form.youtube_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, youtube_url: e.target.value }))
              }
              placeholder="https://youtube.com/..."
            />
          </div>
          <div className="space-y-1">
            <Label>Código de barras EAN-13</Label>
            <Input
              value={form.barcode_ean13}
              onChange={(e) =>
                setForm((f) => ({ ...f, barcode_ean13: e.target.value }))
              }
              placeholder="1234567890123"
            />
          </div>
          <div className="space-y-1">
            <Label>País de origen (2 letras)</Label>
            <Input
              value={form.country_of_origin}
              maxLength={2}
              onChange={(e) =>
                setForm((f) => ({ ...f, country_of_origin: e.target.value }))
              }
              placeholder="ES"
            />
          </div>
          <div className="space-y-1">
            <Label>URL del QR (opcional)</Label>
            <Input
              value={form.qr_target_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, qr_target_url: e.target.value }))
              }
              placeholder="Por defecto va al enlace público"
            />
          </div>
        </div>
      </section>

      {/* === FABRICANTE === */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Fabricante
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Marca del fabricante</Label>
            <Input
              value={form.manufacturer_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, manufacturer_name: e.target.value }))
              }
              placeholder="BWT, Cillit, Pentair..."
            />
          </div>
          <div className="space-y-1">
            <Label>Modelo del fabricante</Label>
            <Input
              value={form.manufacturer_model}
              onChange={(e) =>
                setForm((f) => ({ ...f, manufacturer_model: e.target.value }))
              }
              placeholder="AQA Perla, RO Versa..."
            />
          </div>
        </div>
      </section>

      {/* === GARANTÍAS === */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Garantías (meses)
        </h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>General</Label>
            <Input
              type="number"
              min="0"
              value={form.warranty_months_general}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  warranty_months_general: e.target.value,
                }))
              }
              placeholder="24"
            />
          </div>
          <div className="space-y-1">
            <Label>Electrónica</Label>
            <Input
              type="number"
              min="0"
              value={form.warranty_months_electronics}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  warranty_months_electronics: e.target.value,
                }))
              }
              placeholder="12"
            />
          </div>
          <div className="space-y-1">
            <Label>Carcasa / botella</Label>
            <Input
              type="number"
              min="0"
              value={form.warranty_months_body}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  warranty_months_body: e.target.value,
                }))
              }
              placeholder="60"
            />
          </div>
        </div>
      </section>

      {/* === CICLO DE VIDA === */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Ciclo de vida
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Fecha de discontinuación</Label>
            <Input
              type="date"
              value={form.discontinued_at}
              onChange={(e) =>
                setForm((f) => ({ ...f, discontinued_at: e.target.value }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Si está discontinuado, no se vende a clientes nuevos pero sigue
              dando servicio.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Reemplazado por (otro producto)</Label>
            <select
              value={form.replaced_by_product_id}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  replaced_by_product_id: e.target.value,
                }))
              }
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Ninguno —</option>
              {otherProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Esquema de instalación (imagen o PDF)</Label>
            <Input
              value={form.installation_diagram_url}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  installation_diagram_url: e.target.value,
                }))
              }
              placeholder="https://... (URL de la imagen o documento)"
            />
          </div>
        </div>
      </section>

      {/* === BRANDING DEL PDF === */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Color del PDF (opcional)
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Color de cabecera</Label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={form.datasheet_color_accent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    datasheet_color_accent: e.target.value,
                  }))
                }
                placeholder="#4880FF (déjalo vacío para usar el color de la empresa)"
                className="flex-1"
              />
              {isValidHex(form.datasheet_color_accent) && (
                <div
                  className="h-10 w-10 rounded-md border"
                  style={{ backgroundColor: form.datasheet_color_accent }}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button onClick={save} disabled={pending}>
          {pending ? "Guardando..." : "Guardar datos extendidos"}
        </Button>
      </div>
    </div>
  );
}
