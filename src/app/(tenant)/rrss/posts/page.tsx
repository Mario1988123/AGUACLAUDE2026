import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { listSocialPosts } from "@/modules/social/actions";

export const dynamic = "force-dynamic";

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

const STATUS_TONE: Record<
  string,
  "secondary" | "warning" | "success" | "outline" | "destructive"
> = {
  draft: "secondary",
  review: "warning",
  approved: "success",
  published: "outline",
  cancelled: "outline",
  failed: "destructive",
};

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "draft", label: "Borradores" },
  { key: "review", label: "En revisión" },
  { key: "approved", label: "Aprobados" },
  { key: "published", label: "Publicados" },
];

export default async function SocialPostsKanbanPage() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");

  const all = await listSocialPosts({ limit: 500 });
  const byStatus: Record<string, typeof all> = {};
  for (const p of all) {
    if (!byStatus[p.status]) byStatus[p.status] = [];
    byStatus[p.status]!.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Publicaciones RRSS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kanban por estado. Pulsa una publicación para editarla.
          </p>
        </div>
        <BackButton href="/rrss" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = byStatus[col.key] ?? [];
          return (
            <Card key={col.key} className="min-h-[200px]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>{col.label}</span>
                  <Badge variant={STATUS_TONE[col.key] ?? "outline"}>
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin posts.</p>
                ) : (
                  items.slice(0, 15).map((p) => (
                    <Link
                      key={p.id}
                      href={`/rrss/posts/${p.id}` as never}
                      className="block rounded-lg border bg-card p-2 text-xs hover:border-primary"
                    >
                      <div className="flex gap-2">
                        {p.image_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={p.image_url}
                            alt=""
                            className="h-12 w-12 flex-shrink-0 rounded border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded border border-dashed bg-muted/40 text-[9px] text-muted-foreground"
                            title="Sin imagen"
                          >
                            Sin foto
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold line-clamp-2">{p.topic}</div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{CHANNEL_LABEL[p.channel] ?? p.channel}</span>
                            <span>
                              {new Date(p.scheduled_at).toLocaleDateString(
                                "es-ES",
                                { day: "2-digit", month: "2-digit" },
                              )}
                            </span>
                          </div>
                          {p.image_url ? (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                              ✓ Imagen lista
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
                {items.length > 15 && (
                  <p className="text-[10px] text-muted-foreground">
                    +{items.length - 15} más
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {all.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay publicaciones generadas. Si quieres arrancar con
            un mes completo de contenido, pídelo en la conversación de
            Claude (módulo RRSS · modo autónomo).
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Estados: <strong>Borrador</strong> → generado por IA o creado manual.{" "}
        <strong>En revisión</strong> → esperando aprobación humana.{" "}
        <strong>Aprobado</strong> → listo para publicar.{" "}
        <strong>Publicado</strong> → ya está en el canal correspondiente.
      </p>
    </div>
  );
}
