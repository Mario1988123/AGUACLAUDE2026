import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron mensual del BOE.
 *
 * Lee el RSS de Disposiciones Generales (boe.es) y para cada entrada
 * con keywords relacionadas con permisos laborales/vacaciones/parental,
 * inserta una fila en legal_notices y notifica al admin de cada empresa
 * con time_tracking activo.
 *
 * NO aplica cambios automáticos. Solo alerta para que admin revise el
 * BOE y decida si actualiza absence-labels.ts.
 *
 * Programar con: 0 8 1 * * (1 de cada mes, 08:00).
 */
const KEYWORDS = [
  // Permisos retribuidos
  "permiso", "vacacion", "vacaciones",
  "estatuto de los trabajadores", "estatuto trabajadores",
  "lactancia", "maternidad", "paternidad", "parental",
  "conciliac", // conciliación
  "permiso retribuido", "permiso no retribuido",
  // Reformas tipo
  "real decreto-ley", "real decreto", "decreto-ley",
  // Específicos
  "matrimonio", "fallecimiento", "incapacidad temporal",
  "jornada laboral", "horario laboral",
];

/** Match insensible a tildes + minúsculas. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function matchKeywords(haystack: string): string[] {
  const n = normalize(haystack);
  const hits = new Set<string>();
  for (const kw of KEYWORDS) {
    if (n.includes(normalize(kw))) hits.add(kw);
  }
  return Array.from(hits);
}

/** Parser muy simple de RSS — extrae <item> y dentro <title>, <link>,
 *  <guid>, <pubDate>, <description>. No usamos lib externa porque el
 *  RSS del BOE es estable y queremos cero dependencias. */
function parseRss(xml: string): Array<{
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
}> {
  const items: Array<{
    title: string;
    link: string;
    guid: string;
    pubDate: string;
    description: string;
  }> = [];
  // Split en <item>...</item>
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const tag = (name: string) => {
      const r = new RegExp(`<${name}(?:[^>]*)>([\\s\\S]*?)<\\/${name}>`, "i");
      const r2 = block.match(r);
      if (!r2) return "";
      // Quitar CDATA y entidades básicas
      return r2[1]!
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    };
    items.push({
      title: tag("title"),
      link: tag("link"),
      guid: tag("guid"),
      pubDate: tag("pubDate"),
      description: tag("description"),
    });
  }
  return items;
}

/** Extrae el BOE-A-YYYY-NNNN del guid o link si está. */
function extractBoeId(item: { link: string; guid: string }): string | null {
  const all = `${item.guid} ${item.link}`;
  const m = all.match(/BOE-A-\d{4}-\d+/i);
  return m ? m[0].toUpperCase() : null;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (secret) {
    const ok = auth === `Bearer ${secret}` || xCron === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let inserted = 0;
  let total = 0;
  let usedFeed = "";
  let notified = 0;

  // Probar primero el feed de Disposiciones Generales (es lo que importa
  // para Trabajo y SS). Si falla, caer al sumario diario.
  const feeds = [
    "https://www.boe.es/rss/canal.php?c=disposiciones_generales",
    "https://www.boe.es/rss/canal.php?c=boe",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AguaClaude-BOE-Check/1.0" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRss(xml);
      if (items.length === 0) continue;
      usedFeed = url;
      total = items.length;

      for (const it of items) {
        const haystack = `${it.title} ${it.description}`;
        const matched = matchKeywords(haystack);
        if (matched.length === 0) continue;

        const boeId = extractBoeId(it);
        if (!boeId) continue;

        const boeDate = it.pubDate ? new Date(it.pubDate) : null;
        const boeDateIso =
          boeDate && !isNaN(boeDate.getTime())
            ? boeDate.toISOString().slice(0, 10)
            : null;

        // Insertar si no existe (boe_id es unique)
        const r = await admin
          .from("legal_notices")
          .insert({
            boe_id: boeId,
            boe_date: boeDateIso,
            title: it.title.slice(0, 500),
            url: it.link,
            keywords_matched: matched.join(", "),
          })
          .select("id")
          .maybeSingle();

        if (r.error) {
          // Conflict en boe_id → ya está, no contamos
          if (!/duplicate|unique/i.test(r.error.message ?? "")) {
            console.error("[boe-check insert]", r.error.message);
          }
          continue;
        }
        if (r.data) {
          inserted++;
          // Notificar a admins de cada empresa con time_tracking activo
          try {
            const { data: companies } = await admin
              .from("company_modules")
              .select("company_id")
              .eq("module_key", "time_tracking")
              .eq("is_active", true);
            for (const c of ((companies ?? []) as Array<{ company_id: string }>)) {
              const { data: admins } = await admin
                .from("user_roles")
                .select("user_id")
                .eq("company_id", c.company_id)
                .in("role_key", [
                  "company_admin",
                  "commercial_director",
                  "technical_director",
                  "telemarketing_director",
                ])
                .is("revoked_at", null);
              for (const a of ((admins ?? []) as Array<{ user_id: string }>)) {
                await admin.from("notifications").insert({
                  company_id: c.company_id,
                  recipient_user_id: a.user_id,
                  kind: "time_tracking.boe_alert",
                  severity: "info",
                  title: "Posible cambio legal en permisos",
                  body: `BOE: ${it.title.slice(0, 140)}. Revisa /fichajes/admin/leyes.`,
                });
                notified++;
              }
            }
          } catch (e) {
            console.error("[boe-check notify]", e);
          }
        }
      }
      break; // un feed válido es suficiente
    } catch (e) {
      console.error("[boe-check fetch]", url, e);
    }
  }

  return NextResponse.json({
    ok: true,
    stats: { feed: usedFeed, total, inserted, notified },
    ranAt: new Date().toISOString(),
  });
}
