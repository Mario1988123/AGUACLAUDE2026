import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/auth/session";
import { getCycleDetail } from "@/modules/points/cycles-actions";
import { reasonLabel } from "@/modules/points/reason-labels";
import { toCsv } from "@/shared/lib/csv/to-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fmtCents(c: number): string {
  return (c / 100).toFixed(2).replace(".", ",");
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("es-ES");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session.company_id) {
    return NextResponse.json({ error: "no company" }, { status: 403 });
  }
  const { id } = await params;
  const format = (req.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();

  const detail = await getCycleDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "ciclo no encontrado" }, { status: 404 });
  }

  const periodLabel = `${MONTH_NAMES[detail.cycle.cycle_month - 1]}_${detail.cycle.cycle_year}`;
  const baseFilename = `comisiones_${periodLabel}`;

  if (format === "csv") {
    const headers = [
      "Usuario",
      "Departamento",
      "Tipo",
      "Concepto",
      "Fecha",
      "Puntos",
      "€",
    ];
    const rows: Array<Array<string | number>> = [];
    for (const u of detail.users) {
      for (const line of u.lines) {
        rows.push([
          u.user_name,
          u.department ?? "",
          "Ledger",
          reasonLabel(line.reason),
          fmtDate(line.awarded_at),
          line.points,
          detail.euros_per_point > 0
            ? fmtCents(Math.round(line.points * detail.euros_per_point * 100))
            : "",
        ]);
      }
      for (const a of u.adjustments) {
        rows.push([
          u.user_name,
          u.department ?? "",
          "Ajuste",
          a.reason,
          fmtDate(a.adjusted_at),
          a.delta_points,
          detail.euros_per_point > 0
            ? fmtCents(Math.round(a.delta_points * detail.euros_per_point * 100))
            : "",
        ]);
      }
      // Línea de subtotal por usuario
      rows.push([
        u.user_name,
        u.department ?? "",
        "TOTAL",
        "Subtotal usuario",
        "",
        u.net_points,
        detail.euros_per_point > 0 ? fmtCents(u.net_cents) : "",
      ]);
    }
    rows.push([
      "",
      "",
      "TOTAL CICLO",
      `${MONTH_NAMES[detail.cycle.cycle_month - 1]} ${detail.cycle.cycle_year}`,
      "",
      detail.total_points,
      detail.euros_per_point > 0 ? fmtCents(detail.total_cents) : "",
    ]);

    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseFilename}.csv"`,
      },
    });
  }

  if (format === "pdf") {
    const { newDashDoc } = await import("@/shared/lib/pdf/dashstack");
    const { PDFDocument: _doc, rgb, StandardFonts: _sf } = await import("pdf-lib");
    void _doc;
    void _sf;
    const d = await newDashDoc();
    const PAGE_W = 595;
    const PAGE_H = 842;
    const MARGIN = 40;
    const LINE = 14;

    function newPage() {
      d.page = d.pdf.addPage([PAGE_W, PAGE_H]);
      d.cursorY = PAGE_H - MARGIN;
    }
    function ensure(space: number) {
      if (d.cursorY - space < MARGIN) newPage();
    }
    function text(
      s: string,
      x: number,
      y: number,
      opts?: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> },
    ) {
      d.page.drawText(s, {
        x,
        y,
        size: opts?.size ?? 10,
        font: opts?.bold ? d.bold : d.font,
        color: opts?.color ?? rgb(0.1, 0.1, 0.15),
      });
    }

    // Cabecera
    d.page.drawRectangle({
      x: 0,
      y: PAGE_H - 60,
      width: PAGE_W,
      height: 60,
      color: rgb(20 / 255, 169 / 255, 173 / 255),
    });
    const monthName =
      MONTH_NAMES[detail.cycle.cycle_month - 1] ?? String(detail.cycle.cycle_month);
    text(
      `COMISIONES — ${monthName.toUpperCase()} ${detail.cycle.cycle_year}`,
      MARGIN,
      PAGE_H - 35,
      { bold: true, size: 16, color: rgb(1, 1, 1) },
    );
    text(
      `Periodo: ${fmtDate(detail.cycle.cycle_start_at)} → ${fmtDate(detail.cycle.cycle_end_at)}`,
      MARGIN,
      PAGE_H - 52,
      { size: 9, color: rgb(1, 1, 1) },
    );
    d.cursorY = PAGE_H - 90;

    text(`Total puntos del ciclo: ${detail.total_points}`, MARGIN, d.cursorY, {
      bold: true,
    });
    d.cursorY -= LINE;
    if (detail.euros_per_point > 0) {
      text(
        `Total €: ${fmtCents(detail.total_cents)} € (${detail.euros_per_point.toFixed(4)} €/punto)`,
        MARGIN,
        d.cursorY,
        { bold: true },
      );
      d.cursorY -= LINE;
    }
    if (detail.cycle.status === "closed" && detail.cycle.closed_at) {
      text(
        `Cerrado el ${new Date(detail.cycle.closed_at).toLocaleString("es-ES")} por ${detail.cycle.closed_by_name ?? "—"}`,
        MARGIN,
        d.cursorY,
        { size: 9, color: rgb(0.45, 0.48, 0.55) },
      );
      d.cursorY -= LINE;
    }
    d.cursorY -= LINE / 2;

    for (const u of detail.users) {
      ensure(40);
      // Banner usuario
      d.page.drawRectangle({
        x: MARGIN,
        y: d.cursorY - 16,
        width: PAGE_W - MARGIN * 2,
        height: 18,
        color: rgb(0.93, 0.95, 0.98),
      });
      text(u.user_name, MARGIN + 6, d.cursorY - 11, { bold: true, size: 11 });
      const userTotal = `${u.net_points} pts${
        detail.euros_per_point > 0 ? `  ·  ${fmtCents(u.net_cents)} €` : ""
      }`;
      const totalWidth = d.bold.widthOfTextAtSize(userTotal, 11);
      text(userTotal, PAGE_W - MARGIN - 6 - totalWidth, d.cursorY - 11, {
        bold: true,
        size: 11,
        color: rgb(20 / 255, 130 / 255, 133 / 255),
      });
      d.cursorY -= 24;

      // Líneas
      for (const line of u.lines) {
        ensure(LINE);
        const left = `${fmtDate(line.awarded_at)}  ${reasonLabel(line.reason)}`;
        const right = `${line.points > 0 ? "+" : ""}${line.points} pts`;
        text(left, MARGIN + 12, d.cursorY, { size: 9 });
        const rW = d.font.widthOfTextAtSize(right, 9);
        text(right, PAGE_W - MARGIN - rW, d.cursorY, { size: 9 });
        d.cursorY -= LINE;
      }
      // Ajustes
      for (const a of u.adjustments) {
        ensure(LINE);
        const left = `[Ajuste] ${fmtDate(a.adjusted_at)}  ${a.reason} — ${a.adjusted_by_name ?? ""}`;
        const right = `${a.delta_points > 0 ? "+" : ""}${a.delta_points} pts`;
        text(left, MARGIN + 12, d.cursorY, {
          size: 9,
          color: rgb(0.6, 0.4, 0.0),
        });
        const rW = d.font.widthOfTextAtSize(right, 9);
        text(right, PAGE_W - MARGIN - rW, d.cursorY, {
          size: 9,
          color: rgb(0.6, 0.4, 0.0),
        });
        d.cursorY -= LINE;
      }
      d.cursorY -= LINE / 2;
    }

    const pdfBytes = await d.pdf.save();
    return new NextResponse(pdfBytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseFilename}.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "format not supported" }, { status: 400 });
}
