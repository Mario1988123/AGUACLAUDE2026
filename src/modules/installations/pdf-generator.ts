"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDoc,
  drawHeader,
  drawSection,
  drawKeyValue,
  drawTable,
  drawText,
  drawHr,
  ensureSpace,
  embedImage,
  fmtDateTime,
  COLORS,
  type Doc,
} from "@/shared/lib/pdf/primitives";

const STATUS_LABEL: Record<string, string> = {
  unscheduled: "Sin programar",
  scheduled: "Programada",
  in_progress: "En curso",
  paused: "Pausada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const CATEGORY_LABEL: Record<string, string> = {
  previous_damage: "Daños previos",
  countertop_drilling: "Agujero encimera",
  equipment_location: "Ubicación equipo",
  network_connection: "Conexión red",
  before: "Antes",
  after: "Después",
  other: "Otra",
};

const SIGN_CONTEXT_LABEL: Record<string, string> = {
  work_report: "Parte trabajo",
  previous_damage: "Daños previos",
  countertop_drilling: "Agujero encimera",
};

async function downloadStorageBytes(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).storage.from("documents").download(path);
    if (error || !data) return null;
    const arr = new Uint8Array(await (data as Blob).arrayBuffer());
    const mime = (data as Blob).type || (path.endsWith(".png") ? "image/png" : "image/jpeg");
    return { bytes: arr, mime };
  } catch {
    return null;
  }
}

async function drawPhotoGrid(
  doc: Doc,
  photos: Array<{ storage_path: string; category: string }>,
): Promise<void> {
  if (photos.length === 0) return;
  const cellW = 160;
  const cellH = 120;
  const cols = 3;
  const gap = 10;
  const startX = doc.margin;

  let col = 0;
  let row = 0;
  ensureSpace(doc, cellH + 30);
  doc.cursorY -= cellH;
  let baseY = doc.cursorY;

  for (const p of photos) {
    const dl = await downloadStorageBytes(p.storage_path);
    if (!dl) continue;
    try {
      const img = await embedImage(doc, dl.bytes, dl.mime);
      const aspect = img.width / img.height;
      let w = cellW;
      let h = cellW / aspect;
      if (h > cellH) {
        h = cellH;
        w = cellH * aspect;
      }
      const x = startX + col * (cellW + gap);
      const y = baseY - row * (cellH + 24);
      doc.page.drawImage(img.embed, { x, y, width: w, height: h });
      doc.page.drawText(CATEGORY_LABEL[p.category] ?? p.category, {
        x,
        y: y - 12,
        size: 8,
        font: doc.font,
        color: COLORS.muted,
      });
    } catch {
      /* skip broken image */
    }

    col += 1;
    if (col >= cols) {
      col = 0;
      row += 1;
      ensureSpace(doc, cellH + 30);
      if (doc.cursorY < doc.margin + cellH + 30) {
        baseY = doc.cursorY;
      }
    }
  }
  doc.cursorY = baseY - row * (cellH + 24) - 16;
}

export async function generateWorkReportPdf(installationId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [
    { data: inst },
    { data: items },
    { data: photos },
    { data: signatures },
    { data: company },
  ] = await Promise.all([
    supabase
      .from("installations")
      .select(
        "id, reference_code, status, kind, scheduled_at, started_at, completed_at, duration_seconds, notes, customer_id, contract_id, has_previous_damage, needs_countertop_drilling, geo_distance_to_address_m",
      )
      .eq("id", installationId)
      .single(),
    supabase
      .from("installation_items")
      .select("product_id, serial_number, quantity, notes")
      .eq("installation_id", installationId),
    supabase
      .from("installation_photos")
      .select("storage_path, category")
      .eq("installation_id", installationId)
      .order("taken_at"),
    supabase
      .from("installation_signatures")
      .select("signer_role, signer_name, signer_tax_id, context, signed_at, signature_image_path")
      .eq("installation_id", installationId)
      .order("signed_at"),
    supabase
      .from("companies")
      .select("legal_name, trade_name, tax_id")
      .eq("id", session.company_id)
      .single(),
  ]);

  if (!inst) throw new Error("Instalación no encontrada");
  const i = inst as {
    id: string;
    reference_code: string | null;
    status: string;
    kind: string;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    notes: string | null;
    customer_id: string | null;
    has_previous_damage: boolean | null;
    needs_countertop_drilling: boolean | null;
    geo_distance_to_address_m: number | null;
  };

  let customerName = "—";
  if (i.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
      .eq("id", i.customer_id)
      .single();
    if (c) {
      const cc = c as {
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      customerName =
        cc.party_kind === "company"
          ? cc.trade_name || cc.legal_name || "—"
          : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "—";
    }
  }

  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };

  const doc = await newDoc();
  drawHeader(
    doc,
    `Parte de trabajo ${i.reference_code ?? ""}`.trim(),
    `${co.trade_name || co.legal_name || "Empresa"}${co.tax_id ? ` · ${co.tax_id}` : ""}`,
  );

  drawSection(doc, "Información general");
  drawKeyValue(doc, "Cliente", customerName);
  drawKeyValue(doc, "Estado", STATUS_LABEL[i.status] ?? i.status);
  drawKeyValue(doc, "Tipo", i.kind);
  if (i.scheduled_at) drawKeyValue(doc, "Programada", fmtDateTime(i.scheduled_at));
  if (i.started_at) drawKeyValue(doc, "Iniciada", fmtDateTime(i.started_at));
  if (i.completed_at) drawKeyValue(doc, "Completada", fmtDateTime(i.completed_at));
  if (i.duration_seconds) {
    drawKeyValue(doc, "Duración", `${Math.round(i.duration_seconds / 60)} min`);
  }
  if (i.geo_distance_to_address_m != null) {
    drawKeyValue(doc, "Distancia GPS", `${Math.round(i.geo_distance_to_address_m)} m`);
  }
  drawKeyValue(doc, "Daños previos", i.has_previous_damage ? "Sí" : "No");
  drawKeyValue(doc, "Agujero encimera", i.needs_countertop_drilling ? "Sí" : "No");

  const list = (items ?? []) as Array<{
    product_id: string;
    serial_number: string | null;
    quantity: number;
    notes: string | null;
  }>;
  if (list.length > 0) {
    drawSection(doc, "Equipos instalados");
    drawTable(
      doc,
      ["Producto (id)", "Cant.", "S/N", "Notas"],
      list.map((it) => ({
        cells: [
          it.product_id.slice(0, 12),
          String(it.quantity),
          it.serial_number ?? "—",
          it.notes ?? "—",
        ],
      })),
      [120, 50, 130, 200],
    );
  }

  if (i.notes) {
    drawSection(doc, "Notas del técnico");
    drawText(doc, i.notes, { size: 10, maxWidth: 495 });
  }

  const photoList = (photos ?? []) as Array<{ storage_path: string; category: string }>;
  if (photoList.length > 0) {
    drawSection(doc, `Fotos (${photoList.length})`);
    await drawPhotoGrid(doc, photoList);
  }

  const signList = (signatures ?? []) as Array<{
    signer_role: string;
    signer_name: string;
    signer_tax_id: string | null;
    context: string | null;
    signed_at: string;
    signature_image_path: string;
  }>;
  if (signList.length > 0) {
    drawSection(doc, "Firmas");
    for (const s of signList) {
      ensureSpace(doc, 100);
      doc.cursorY -= 14;
      doc.page.drawText(`${SIGN_CONTEXT_LABEL[s.context ?? ""] ?? s.context ?? "—"}`, {
        x: doc.margin,
        y: doc.cursorY,
        size: 10,
        font: doc.bold,
        color: COLORS.brand,
      });
      doc.cursorY -= 12;
      doc.page.drawText(`${s.signer_name}${s.signer_tax_id ? ` · ${s.signer_tax_id}` : ""}`, {
        x: doc.margin,
        y: doc.cursorY,
        size: 9,
        font: doc.font,
        color: COLORS.text,
      });
      doc.page.drawText(fmtDateTime(s.signed_at), {
        x: doc.margin,
        y: doc.cursorY - 11,
        size: 8,
        font: doc.font,
        color: COLORS.muted,
      });
      doc.cursorY -= 80;
      const dl = await downloadStorageBytes(s.signature_image_path);
      if (dl) {
        try {
          const img = await embedImage(doc, dl.bytes, dl.mime);
          const targetH = 70;
          const aspect = img.width / img.height;
          const w = Math.min(targetH * aspect, 250);
          const h = w / aspect;
          doc.page.drawImage(img.embed, {
            x: doc.margin,
            y: doc.cursorY,
            width: w,
            height: h,
          });
        } catch {
          /* skip */
        }
      }
      drawHr(doc);
    }
  }

  return await doc.pdf.save();
}
