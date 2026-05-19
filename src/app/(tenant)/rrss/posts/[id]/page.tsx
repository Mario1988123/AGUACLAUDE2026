import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { getSocialPost } from "@/modules/social/actions";
import { PostStatusButtons } from "@/modules/social/post-status-buttons";

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

const TYPE_LABEL: Record<string, string> = {
  educational: "Educativo",
  ephemeris: "Efeméride",
  commercial_soft: "Comercial suave",
  technical_authority: "Autoridad técnica",
  local: "Cercanía / local",
  visual_reel: "Visual / Reel",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  review: "En revisión",
  approved: "Aprobado",
  published: "Publicado",
  cancelled: "Cancelado",
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
};

export default async function SocialPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");

  const { id } = await params;
  const post = await getSocialPost(id);
  if (!post) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <BackButton href="/rrss/posts" />
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            {post.topic}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={STATUS_TONE[post.status] ?? "outline"}>
              {STATUS_LABEL[post.status] ?? post.status}
            </Badge>
            <Badge variant="outline">
              {CHANNEL_LABEL[post.channel] ?? post.channel}
            </Badge>
            <Badge variant="outline">
              {TYPE_LABEL[post.content_type] ?? post.content_type}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Programado para{" "}
              {new Date(post.scheduled_at).toLocaleString("es-ES")}
            </span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado y acciones</CardTitle>
        </CardHeader>
        <CardContent>
          <PostStatusButtons postId={post.id} currentStatus={post.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Copy principal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
            {post.copy_main}
          </pre>
          {post.copy_short && (
            <div>
              <div className="text-xs font-bold uppercase text-muted-foreground">
                Versión corta
              </div>
              <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
                {post.copy_short}
              </pre>
            </div>
          )}
          {post.copy_linkedin && (
            <div>
              <div className="text-xs font-bold uppercase text-muted-foreground">
                Versión LinkedIn
              </div>
              <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
                {post.copy_linkedin}
              </pre>
            </div>
          )}
          {post.cta && (
            <div>
              <div className="text-xs font-bold uppercase text-muted-foreground">
                CTA
              </div>
              <p className="text-sm">{post.cta}</p>
            </div>
          )}
          {post.hashtags && post.hashtags.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase text-muted-foreground">
                Hashtags
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {post.hashtags.map((h) => (
                  <span
                    key={h}
                    className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(post.image_prompt || post.image_alt_text) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imagen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {post.image_format && (
              <div>
                <span className="text-xs text-muted-foreground">Formato:</span>{" "}
                <strong>{post.image_format}</strong>
              </div>
            )}
            {post.image_prompt && (
              <div>
                <div className="text-xs font-bold uppercase text-muted-foreground">
                  Prompt
                </div>
                <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
                  {post.image_prompt}
                </pre>
              </div>
            )}
            {post.image_prompt_alt && (
              <div>
                <div className="text-xs font-bold uppercase text-muted-foreground">
                  Prompt alternativo
                </div>
                <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
                  {post.image_prompt_alt}
                </pre>
              </div>
            )}
            {post.image_alt_text && (
              <div>
                <div className="text-xs font-bold uppercase text-muted-foreground">
                  Texto alternativo (accesibilidad)
                </div>
                <p>{post.image_alt_text}</p>
              </div>
            )}
            {post.image_url && (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image_url}
                  alt={post.image_alt_text ?? post.topic}
                  className="max-w-full rounded-xl border"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(post.seo_title || post.seo_meta_description) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SEO (blog)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {post.seo_title && (
              <div>
                <span className="text-xs text-muted-foreground">Título:</span>{" "}
                <strong>{post.seo_title}</strong>
              </div>
            )}
            {post.seo_meta_description && (
              <div>
                <span className="text-xs text-muted-foreground">
                  Meta description:
                </span>{" "}
                {post.seo_meta_description}
              </div>
            )}
            {post.seo_excerpt && (
              <div>
                <span className="text-xs text-muted-foreground">Extracto:</span>{" "}
                {post.seo_excerpt}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {post.email_subject && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Newsletter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">Asunto:</div>
            <p className="font-bold">{post.email_subject}</p>
          </CardContent>
        </Card>
      )}

      {post.reel_script && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guion del reel</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm font-sans">
              {post.reel_script}
            </pre>
          </CardContent>
        </Card>
      )}

      {(post.target_segment || post.intent_level) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Targeting</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            {post.target_segment && (
              <div>
                <span className="text-xs text-muted-foreground">Segmento:</span>{" "}
                <strong>{post.target_segment}</strong>
              </div>
            )}
            <div>
              <span className="text-xs text-muted-foreground">
                Intención comercial:
              </span>{" "}
              <strong>{post.intent_level}</strong>
            </div>
          </CardContent>
        </Card>
      )}

      {(post.notes || post.review_notes) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {post.notes && (
              <div>
                <div className="text-xs text-muted-foreground">Notas:</div>
                <p>{post.notes}</p>
              </div>
            )}
            {post.review_notes && (
              <div>
                <div className="text-xs text-muted-foreground">
                  Notas de revisión:
                </div>
                <p>{post.review_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
