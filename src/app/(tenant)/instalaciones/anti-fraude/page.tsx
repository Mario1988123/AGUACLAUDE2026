import Link from "next/link";
import { ShieldAlert, MapPinOff, ArrowRight } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { BackButton } from "@/shared/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

interface FraudEvent {
  id: string;
  kind: "installation.geo_off_road" | "installation.start_far_from_address";
  subject_id: string;
  created_at: string;
  payload: Record<string, unknown> | null;
  actor_user_id: string | null;
  reference_code: string | null;
  installer_name: string | null;
}

export default async function AntiFraudPage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    redirect("/dashboard");
  }
  if (!session.company_id) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ninetyDaysAgo = new Date(
    Date.now() - 90 * 86400000,
  ).toISOString();

  const { data: rows } = await admin
    .from("events")
    .select("id, kind, subject_id, created_at, payload, actor_user_id")
    .eq("company_id", session.company_id)
    .in("kind", [
      "installation.geo_off_road",
      "installation.start_far_from_address",
    ])
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(200);

  type Raw = {
    id: string;
    kind: FraudEvent["kind"];
    subject_id: string;
    created_at: string;
    payload: Record<string, unknown> | null;
    actor_user_id: string | null;
  };
  const events = (rows ?? []) as Raw[];

  // Enriquecer con reference_code de la instalación y nombre del técnico
  const installationIds = Array.from(new Set(events.map((e) => e.subject_id)));
  const userIds = Array.from(
    new Set(events.map((e) => e.actor_user_id).filter((v): v is string => !!v)),
  );

  const refByInst = new Map<string, string>();
  if (installationIds.length > 0) {
    const { data: insts } = await admin
      .from("installations")
      .select("id, reference_code")
      .in("id", installationIds);
    for (const it of (insts ?? []) as Array<{
      id: string;
      reference_code: string | null;
    }>) {
      if (it.reference_code) refByInst.set(it.id, it.reference_code);
    }
  }

  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profs ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      if (p.full_name) nameByUser.set(p.user_id, p.full_name);
    }
  }

  const enriched: FraudEvent[] = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    subject_id: e.subject_id,
    created_at: e.created_at,
    payload: e.payload,
    actor_user_id: e.actor_user_id,
    reference_code: refByInst.get(e.subject_id) ?? null,
    installer_name: e.actor_user_id
      ? nameByUser.get(e.actor_user_id) ?? null
      : null,
  }));

  const offRoad = enriched.filter(
    (e) => e.kind === "installation.geo_off_road",
  );
  const startFar = enriched.filter(
    (e) => e.kind === "installation.start_far_from_address",
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
            <h1 className="text-2xl font-bold">Anti-fraude geo</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Instalaciones cuyas coordenadas GPS no cuadran con la dirección
            registrada o con cualquier calle conocida. Datos de los últimos
            90 días. Umbrales configurables en{" "}
            <Link
              href="/configuracion/google-maps"
              className="font-bold text-primary hover:underline"
            >
              /configuracion/google-maps
            </Link>
            .
          </p>
        </div>
        <BackButton href="/instalaciones" />
      </div>

      <FraudCard
        title="GPS fuera de calle al cerrar"
        description="El snap-to-roads de Google indica que el cierre del parte se hizo lejos de una calle conocida. Posible GPS spoof o cierre en un punto no transitable."
        icon={<MapPinOff className="h-5 w-5 text-rose-600" />}
        events={offRoad}
      />
      <FraudCard
        title="Inicio lejos de la dirección"
        description="La posición GPS al iniciar el parte se aleja de la dirección registrada del cliente más de lo permitido."
        icon={<ShieldAlert className="h-5 w-5 text-amber-600" />}
        events={startFar}
      />
    </div>
  );
}

function FraudCard({
  title,
  description,
  icon,
  events,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  events: FraudEvent[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
          <Badge variant={events.length > 0 ? "destructive" : "outline"}>
            {events.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3 text-sm text-emerald-900">
            ✓ Sin incidencias en los últimos 90 días.
          </p>
        ) : (
          <div className="divide-y rounded-xl border">
            {events.map((e) => {
              const distance = (e.payload?.["distance_m"] as number) ?? null;
              const threshold = (e.payload?.["threshold_m"] as number) ?? null;
              return (
                <Link
                  key={e.id}
                  href={`/instalaciones/${e.subject_id}` as never}
                  className="flex items-center gap-3 p-3 text-sm hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">
                      {e.reference_code ?? e.subject_id.slice(0, 8)}
                      {e.installer_name ? ` · ${e.installer_name}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString("es-ES")}
                      {distance != null && (
                        <>
                          {" · "}
                          <span className="font-bold text-rose-700">
                            {distance} m
                          </span>
                          {threshold != null && ` / umbral ${threshold} m`}
                        </>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
