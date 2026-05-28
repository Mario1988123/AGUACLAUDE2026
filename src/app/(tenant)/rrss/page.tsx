import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Megaphone, Newspaper, Sparkles, ListTodo } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import {
  listEphemeridesForMonth,
  listSocialPosts,
  type Ephemeris,
  type SocialPost,
} from "@/modules/social/actions";
import { GenerateMonthButton } from "@/modules/social/generate-button";

export const dynamic = "force-dynamic";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  google_business: "Google Business",
  blog: "Blog",
  newsletter: "Newsletter",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  review: "En revisión",
  approved: "Aprobado",
  published: "Publicado",
  cancelled: "Cancelado",
  failed: "Fallido",
};

const STATUS_TONE: Record<string, "secondary" | "warning" | "success" | "outline" | "destructive"> = {
  draft: "secondary",
  review: "warning",
  approved: "success",
  published: "outline",
  cancelled: "outline",
  failed: "destructive",
};

export default async function SocialDashboardPage() {
  await assertModuleActive("social_media");
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStart = new Date(year, month - 1, 1).toISOString();
  const nextMonthStart = new Date(year, month, 1).toISOString();

  const [ephemerides, posts, draftPosts] = await Promise.all([
    listEphemeridesForMonth(month).catch(() => [] as Ephemeris[]),
    listSocialPosts({ from: monthStart, to: nextMonthStart, limit: 200 }).catch(
      () => [] as SocialPost[],
    ),
    listSocialPosts({ status: "review", limit: 20 }).catch(() => [] as SocialPost[]),
  ]);

  const byStatus = posts.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            RRSS · Calendario editorial
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Calendario automático de contenidos para Instagram, Facebook,
            LinkedIn, blog y newsletter. Generación + revisión humana antes de
            publicar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/rrss/efemerides"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <Sparkles className="h-4 w-4" /> Efemérides
          </Link>
          <Link
            href="/rrss/posts"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <ListTodo className="h-4 w-4" /> Todos los posts
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-primary/30 bg-primary/5 p-3">
        <div className="text-sm">
          <strong>Generador automático.</strong> Crea los borradores del mes
          basándose en efemérides + plantillas educativas/comerciales/
          técnicas. Idempotente: si el día/canal ya tiene post, no duplica.
        </div>
        <GenerateMonthButton defaultMonth={month} defaultYear={year} />
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Kpi label="Total mes" value={posts.length} icon={<CalendarDays className="h-5 w-5" />} />
        <Kpi label="Borradores" value={byStatus.draft ?? 0} tone="muted" />
        <Kpi label="En revisión" value={byStatus.review ?? 0} tone="warning" />
        <Kpi label="Aprobados" value={byStatus.approved ?? 0} tone="success" />
        <Kpi label="Publicados" value={byStatus.published ?? 0} tone="muted" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Efemérides de {MONTHS[month - 1]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ephemerides.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin efemérides relevantes este mes.
              </p>
            ) : (
              <ul className="space-y-2">
                {ephemerides.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start justify-between gap-2 rounded-xl border p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">
                        {String(e.day_of_month).padStart(2, "0")}/
                        {String(e.month_of_year).padStart(2, "0")} ·{" "}
                        {e.name}
                      </div>
                      {e.description && (
                        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {e.description}
                        </div>
                      )}
                      {e.official_org && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {e.is_official ? "✓ Oficial · " : "ⓘ "}
                          {e.official_org}
                        </div>
                      )}
                    </div>
                    {e.importance === "high" && (
                      <Badge variant="default">Alta</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-primary" />
              Pendientes de revisar ({draftPosts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {draftPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay borradores esperando revisión.
              </p>
            ) : (
              <ul className="space-y-2">
                {draftPosts.slice(0, 10).map((p) => (
                  <li key={p.id} className="rounded-xl border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/rrss/posts/${p.id}` as never}
                        className="font-medium text-primary hover:underline truncate"
                      >
                        {p.topic}
                      </Link>
                      <Badge variant={STATUS_TONE[p.status] ?? "outline"}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {CHANNEL_LABEL[p.channel] ?? p.channel} ·{" "}
                      {new Date(p.scheduled_at).toLocaleDateString("es-ES")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Publicaciones programadas para {MONTHS[month - 1]} ({posts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Aún no hay publicaciones programadas. El módulo está listo —
                cuando actives el modo autónomo o crees borradores manuales
                aparecerán aquí.
              </p>
              <Link
                href="/rrss/posts"
                className="inline-flex items-center text-sm font-semibold text-primary hover:underline"
              >
                Ir al listado de posts →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Canal</th>
                    <th className="px-3 py-2 text-left">Tema</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {posts.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {new Date(p.scheduled_at).toLocaleString("es-ES", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {CHANNEL_LABEL[p.channel] ?? p.channel}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/rrss/posts/${p.id}` as never}
                          className="font-medium text-primary hover:underline"
                        >
                          {p.topic}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs">{p.content_type}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_TONE[p.status] ?? "outline"}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = "primary",
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "muted";
}) {
  const cls = {
    primary: "bg-primary/5 text-primary border-primary/20",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    muted: "bg-muted/40 text-muted-foreground border-border",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
