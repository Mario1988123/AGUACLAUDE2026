// =============================================================================
// generator.ts
// Genera borradores de RRSS para un mes/año concreto a partir de plantillas
// + efemérides + ajustes de marca. Usable desde:
//   · UI (botón "Generar mes X")
//   · Cron mensual (día 25 prepara el mes siguiente para empresas con
//     autonomous_mode = true)
//
// Diseño:
//   1. Lee social_settings (brand_name, brand_hashtag, base_hashtags,
//      weekly_target). Fallback a company_settings.fiscal_legal_name si
//      brand_name está vacío.
//   2. Lee efemérides del mes desde social_ephemerides.
//   3. Calcula slots semanales según weekly_target.
//   4. Para cada slot, elige plantilla con rotación basada en historial
//      (evita repetir templates publicados en los últimos 90 días).
//   5. Para cada efeméride del mes, expande sus templates (fases 1/2/3)
//      con fechas calculadas (antes / día oficial / después).
//   6. Inserta todos los posts como 'draft' en social_posts.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_TEMPLATES,
  EDUCATIONAL,
  COMMERCIAL_SOFT,
  TECHNICAL_AUTHORITY,
  LOCAL,
  EPHEMERIS_TEMPLATES,
  applyVariables,
  type ContentTemplate,
  type Channel,
} from "./content-templates";

export interface GenerationResult {
  ok: boolean;
  posts_created: number;
  ephemerides_used: number;
  templates_used: string[];
  errors: string[];
}

interface BrandData {
  brand_name: string;
  brand_hashtag: string | null;
  base_hashtags: string[];
}

interface EphemerisRow {
  id: string;
  slug: string;
  name: string;
  day_of_month: number;
  month_of_year: number;
  hashtags: string[];
  importance: string;
}

/**
 * Genera el calendario editorial para una empresa en un mes concreto.
 * Idempotente: si ya hay posts del mes, NO duplica (salta los días con
 * post existente del mismo canal). Útil para regenerar parcialmente.
 */
export async function generateMonthlyPosts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  companyId: string,
  year: number,
  month: number,
  options: { reviewerUserId?: string | null } = {},
): Promise<GenerationResult> {
  const result: GenerationResult = {
    ok: false,
    posts_created: 0,
    ephemerides_used: 0,
    templates_used: [],
    errors: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // 1) Brand data + hashtags base.
  const brand = await loadBrandData(adminAny, companyId);

  // 2) Efemérides del mes.
  const { data: ephRaw } = await adminAny
    .from("social_ephemerides")
    .select("id, slug, name, day_of_month, month_of_year, hashtags, importance")
    .eq("month_of_year", month)
    .order("day_of_month");
  const ephemerides = (ephRaw ?? []) as EphemerisRow[];

  // 3) Posts ya existentes del mes (idempotencia).
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const { data: existing } = await adminAny
    .from("social_posts")
    .select("scheduled_at, channel, ephemeris_id, campaign_phase")
    .eq("company_id", companyId)
    .gte("scheduled_at", monthStart)
    .lt("scheduled_at", nextMonth);
  const existingKeys = new Set(
    ((existing ?? []) as Array<{
      scheduled_at: string;
      channel: string;
      ephemeris_id: string | null;
      campaign_phase: number | null;
    }>).map((p) => keyOf(p.scheduled_at, p.channel)),
  );
  const existingEphPhases = new Set(
    ((existing ?? []) as Array<{ ephemeris_id: string | null; campaign_phase: number | null }>)
      .filter((p) => p.ephemeris_id)
      .map((p) => `${p.ephemeris_id}-${p.campaign_phase ?? 2}`),
  );

  // 4) Historial reciente para evitar repetir templates (last 90d).
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentTemplateIds = await loadRecentTemplateIds(adminAny, companyId, ninetyDaysAgo.toISOString());

  // 5) Generar publicaciones de efemérides del mes (prioritarias).
  const postsToInsert: PostInsert[] = [];
  for (const eph of ephemerides) {
    const phases = EPHEMERIS_TEMPLATES.filter((t) => t.ephemeris_slug === eph.slug);
    for (const tpl of phases) {
      const phase = tpl.campaign_phase ?? 2;
      const dupKey = `${eph.id}-${phase}`;
      if (existingEphPhases.has(dupKey)) continue;
      const date = computePhaseDate(year, month, eph.day_of_month, phase);
      for (const channel of tpl.channels) {
        const k = keyOf(date.toISOString(), channel);
        if (existingKeys.has(k)) continue;
        postsToInsert.push(
          buildPost(tpl, channel, date, companyId, brand, options.reviewerUserId ?? null, eph),
        );
        existingKeys.add(k);
        result.templates_used.push(tpl.id);
      }
    }
    result.ephemerides_used += 1;
  }

  // 6) Generar publicaciones recurrentes (educativas, comerciales, técnicas,
  // local) según slot semanal. Distribución: cada lunes/miércoles/viernes
  // pública IG/FB; cada martes y jueves LinkedIn.
  const slots = computeMonthlySlots(year, month);
  const rotatedTemplates = pickRotatedTemplates(recentTemplateIds);

  let templateIdx = 0;
  for (const slot of slots) {
    const date = slot.date;
    for (const channel of slot.channels) {
      const k = keyOf(date.toISOString(), channel);
      if (existingKeys.has(k)) continue;
      const tpl = pickTemplateForChannel(rotatedTemplates, channel, templateIdx);
      if (!tpl) continue;
      templateIdx += 1;
      postsToInsert.push(
        buildPost(tpl, channel, date, companyId, brand, options.reviewerUserId ?? null, null),
      );
      existingKeys.add(k);
      result.templates_used.push(tpl.id);
    }
  }

  // 7) Insert masivo. Chunks de 50 para no romper PostgREST.
  if (postsToInsert.length > 0) {
    for (let i = 0; i < postsToInsert.length; i += 50) {
      const chunk = postsToInsert.slice(i, i + 50);
      const { error } = await adminAny.from("social_posts").insert(chunk);
      if (error) {
        result.errors.push(`chunk ${i}: ${error.message}`);
      } else {
        result.posts_created += chunk.length;
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

// =============================================================================
// Helpers
// =============================================================================

interface PostInsert {
  company_id: string;
  scheduled_at: string;
  channel: string;
  content_type: string;
  ephemeris_id: string | null;
  campaign_phase: number | null;
  topic: string;
  copy_main: string;
  copy_short: string | null;
  copy_linkedin: string | null;
  cta: string | null;
  hashtags: string[];
  image_prompt: string | null;
  image_prompt_alt: string | null;
  image_alt_text: string | null;
  image_format: string;
  target_segment: string | null;
  intent_level: string;
  status: string;
  notes: string | null;
}

async function loadBrandData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
): Promise<BrandData> {
  // 1) social_settings
  const { data: ss } = await admin
    .from("social_settings")
    .select("brand_name, brand_hashtag, base_hashtags")
    .eq("company_id", companyId)
    .maybeSingle();
  let brandName: string | null =
    (ss as { brand_name?: string | null } | null)?.brand_name ?? null;
  const brandHashtag =
    (ss as { brand_hashtag?: string | null } | null)?.brand_hashtag ?? null;
  const baseHashtags =
    ((ss as { base_hashtags?: string[] } | null)?.base_hashtags ?? []) as string[];

  // 2) Fallback: nombre fiscal de la empresa
  if (!brandName) {
    const { data: cs } = await admin
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_trade_name")
      .eq("company_id", companyId)
      .maybeSingle();
    brandName =
      (cs as { fiscal_trade_name?: string | null } | null)?.fiscal_trade_name ||
      (cs as { fiscal_legal_name?: string | null } | null)?.fiscal_legal_name ||
      null;
  }

  // 3) Fallback final: nombre de la empresa
  if (!brandName) {
    const { data: c } = await admin
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    brandName = (c as { name?: string | null } | null)?.name ?? "tu equipo";
  }

  return {
    brand_name: brandName,
    brand_hashtag: brandHashtag,
    base_hashtags: baseHashtags,
  };
}

async function loadRecentTemplateIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  sinceIso: string,
): Promise<Set<string>> {
  // Usamos notes para guardar el template_id (no rompemos schema).
  // Buscamos posts recientes con "template:" en notes.
  const { data } = await admin
    .from("social_posts")
    .select("notes")
    .eq("company_id", companyId)
    .gte("scheduled_at", sinceIso);
  const set = new Set<string>();
  for (const r of ((data ?? []) as Array<{ notes: string | null }>)) {
    if (!r.notes) continue;
    const m = r.notes.match(/template:([\w-]+)/);
    if (m) set.add(m[1]!);
  }
  return set;
}

function pickRotatedTemplates(recentIds: Set<string>) {
  return {
    educational: EDUCATIONAL.filter((t) => !recentIds.has(t.id)).length > 0
      ? EDUCATIONAL.filter((t) => !recentIds.has(t.id))
      : EDUCATIONAL,
    commercial: COMMERCIAL_SOFT.filter((t) => !recentIds.has(t.id)).length > 0
      ? COMMERCIAL_SOFT.filter((t) => !recentIds.has(t.id))
      : COMMERCIAL_SOFT,
    technical: TECHNICAL_AUTHORITY.filter((t) => !recentIds.has(t.id)).length > 0
      ? TECHNICAL_AUTHORITY.filter((t) => !recentIds.has(t.id))
      : TECHNICAL_AUTHORITY,
    local: LOCAL.filter((t) => !recentIds.has(t.id)).length > 0
      ? LOCAL.filter((t) => !recentIds.has(t.id))
      : LOCAL,
  };
}

function pickTemplateForChannel(
  pool: ReturnType<typeof pickRotatedTemplates>,
  channel: Channel,
  idx: number,
): ContentTemplate | null {
  if (channel === "linkedin") {
    // LinkedIn alterna técnico / comercial.
    const tech = pool.technical;
    const com = pool.commercial.filter((t) => t.channels.includes("linkedin"));
    const choices = idx % 2 === 0 ? tech : com.length > 0 ? com : tech;
    return choices[idx % choices.length] ?? null;
  }
  // IG/FB rota educativo/comercial/local
  const cycle = (idx % 5);
  if (cycle === 0 || cycle === 1) return pool.educational[idx % pool.educational.length] ?? null;
  if (cycle === 2) return pool.commercial[idx % pool.commercial.length] ?? null;
  if (cycle === 3) return pool.local[idx % pool.local.length] ?? null;
  return pool.educational[idx % pool.educational.length] ?? null;
}

interface MonthlySlot {
  date: Date;
  channels: Channel[];
}

function computeMonthlySlots(year: number, month: number): MonthlySlot[] {
  // Año/mes 1-based; en Date el mes es 0-based.
  const slots: MonthlySlot[] = [];
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, month - 1, d, 10, 0, 0);
    const dow = date.getDay(); // 0=domingo, 1=lunes... 6=sábado
    // Lun/Mié/Vie → IG+FB. Mar/Jue → LinkedIn.
    if (dow === 1 || dow === 3 || dow === 5) {
      slots.push({ date, channels: ["instagram", "facebook"] });
    } else if (dow === 2 || dow === 4) {
      slots.push({ date: setHour(date, 9), channels: ["linkedin"] });
    }
  }
  return slots;
}

function setHour(d: Date, h: number): Date {
  const x = new Date(d);
  x.setHours(h, 0, 0, 0);
  return x;
}

function computePhaseDate(
  year: number,
  month: number,
  dayOfMonth: number,
  phase: number,
): Date {
  // Fase 1: 7 días antes. Fase 2: el día. Fase 3: 3 días después.
  const base = new Date(year, month - 1, dayOfMonth, 9, 0, 0);
  if (phase === 1) base.setDate(base.getDate() - 7);
  else if (phase === 3) base.setDate(base.getDate() + 3);
  // Si por fase 1 nos salimos del mes, lo dejamos igual — caerá en mes anterior.
  return base;
}

function keyOf(scheduledAt: string, channel: string): string {
  const d = new Date(scheduledAt);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${channel}`;
}

function buildPost(
  tpl: ContentTemplate,
  channel: Channel,
  date: Date,
  companyId: string,
  brand: BrandData,
  reviewerUserId: string | null,
  ephemeris: EphemerisRow | null,
): PostInsert {
  void reviewerUserId;
  const vars = {
    brand_name: brand.brand_name,
    brand_hashtag: brand.brand_hashtag,
    ephemeris_name: ephemeris?.name ?? null,
    ephemeris_date: ephemeris
      ? `${String(ephemeris.day_of_month).padStart(2, "0")}/${String(ephemeris.month_of_year).padStart(2, "0")}`
      : null,
  };

  const hashtags = Array.from(
    new Set([
      ...(brand.brand_hashtag ? [brand.brand_hashtag] : []),
      ...brand.base_hashtags,
      ...(tpl.hashtags_extra ?? []),
      ...(ephemeris?.hashtags ?? []),
    ]),
  );

  return {
    company_id: companyId,
    scheduled_at: date.toISOString(),
    channel,
    content_type: tpl.content_type,
    ephemeris_id: ephemeris?.id ?? null,
    campaign_phase: tpl.campaign_phase ?? null,
    topic: tpl.topic,
    copy_main: applyVariables(tpl.copy_main, vars),
    copy_short: tpl.copy_short ? applyVariables(tpl.copy_short, vars) : null,
    copy_linkedin: tpl.copy_linkedin ? applyVariables(tpl.copy_linkedin, vars) : null,
    cta: tpl.cta ? applyVariables(tpl.cta, vars) : null,
    hashtags,
    image_prompt: applyVariables(tpl.image_prompt, vars),
    image_prompt_alt: tpl.image_prompt_alt ? applyVariables(tpl.image_prompt_alt, vars) : null,
    image_alt_text: applyVariables(tpl.image_alt, vars),
    image_format: tpl.image_format,
    target_segment: tpl.target_segment ?? null,
    intent_level: tpl.intent_level,
    status: "draft",
    notes: `template:${tpl.id}`,
  };
}

void ALL_TEMPLATES;
