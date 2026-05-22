import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { getMyPoints, getPointsRanking } from "@/modules/points/ranking-actions";
import { PointsRankingCard } from "@/modules/points/ranking-card";
import {
  getMyMilestones,
  getMyPointsHistory,
} from "@/modules/points/milestones-actions";
import {
  MilestonesCard,
  PointsHistoryCard,
} from "@/modules/points/milestones-card";
import { getPointsBreakdownSafeAction } from "@/modules/points/breakdown-actions";
import { PointsBreakdownCard } from "@/modules/points/breakdown-card";
import { resolveVisibleUserIds } from "@/shared/lib/auth/role-scope";
import { KpiCard } from "@/shared/components/kpi-card";

export const dynamic = "force-dynamic";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

const DEPT_OF_ROLE: Record<string, "tech" | "sales" | "tmk"> = {
  technical_director: "tech",
  installer: "tech",
  commercial_director: "sales",
  sales_rep: "sales",
  telemarketing_director: "tmk",
  telemarketer: "tmk",
};

function getUserDept(roles: string[]): "tech" | "sales" | "tmk" | null {
  for (const r of roles) {
    const d = DEPT_OF_ROLE[r];
    if (d) return d;
  }
  return null;
}

function getUserLevel(roles: string[], isSuper: boolean): 1 | 2 | 3 {
  if (isSuper || roles.includes("company_admin")) return 1;
  if (
    roles.includes("technical_director") ||
    roles.includes("commercial_director") ||
    roles.includes("telemarketing_director")
  )
    return 2;
  return 3;
}

export default async function PuntosPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; breakdown?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const level = getUserLevel(session.roles, session.is_superadmin);
  const myDept = getUserDept(session.roles);

  const filterDept =
    level === 1 && (sp.dept === "tech" || sp.dept === "sales" || sp.dept === "tmk")
      ? sp.dept
      : null;

  // Resolver qué user_ids puede ver la sesión en detalle (admin = todos)
  const visibleUserIds = await resolveVisibleUserIds(session);
  // El propio usuario siempre se ve a sí mismo aunque sea nivel 3
  const ownBreakdownUserId =
    sp.breakdown && typeof sp.breakdown === "string"
      ? sp.breakdown
      : level === 3
        ? session.user_id
        : null;

  // Scope efectivo:
  // Nivel 3 → su departamento
  // Nivel 2 → su departamento
  // Nivel 1 → all (con filtro opcional dpto)
  let scopeArgs: Parameters<typeof getPointsRanking>[0];
  if (level === 1) {
    scopeArgs = filterDept
      ? { scope: "department", department: filterDept }
      : { scope: "all" };
  } else {
    scopeArgs = { scope: "department", department: myDept ?? "sales" };
  }

  const [my, ranking, milestones, history, breakdownResult] = await Promise.all([
    getMyPoints(),
    getPointsRanking(scopeArgs),
    getMyMilestones(),
    getMyPointsHistory(12),
    ownBreakdownUserId
      ? getPointsBreakdownSafeAction(ownBreakdownUserId)
      : Promise.resolve(null as null),
  ]);
  const breakdown =
    breakdownResult && breakdownResult.ok ? breakdownResult.data : null;

  const rankingTitle =
    level === 1
      ? filterDept
        ? `Clasificación · ${DEPT_LABEL[filterDept]}`
        : "Clasificación global"
      : level === 2
        ? `Clasificación de mi equipo (${DEPT_LABEL[myDept ?? "sales"]})`
        : `Clasificación de mi departamento (${DEPT_LABEL[myDept ?? "sales"]})`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Puntos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programa de incentivos. Los puntos se acumulan automáticamente al captar leads,
            cerrar ventas, instalar, mantener o resolver incidencias.
          </p>
        </div>
        {level === 1 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={"/puntos" as never}
              className={`inline-flex h-10 items-center rounded-xl border-2 px-3 text-sm font-semibold ${
                !filterDept
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              Global
            </Link>
            {(["tech", "sales", "tmk"] as const).map((d) => (
              <Link
                key={d}
                href={`/puntos?dept=${d}` as never}
                className={`inline-flex h-10 items-center rounded-xl border-2 px-3 text-sm font-semibold ${
                  filterDept === d
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                {DEPT_LABEL[d]}
              </Link>
            ))}
          </div>
        )}
      </div>

      {level === 3 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            label="Mis puntos · este mes"
            value={my.month}
            icon="Star"
            iconColor="primary"
          />
          <KpiCard
            label="Mis puntos · este año"
            value={my.year}
            icon="Trophy"
            iconColor="success"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <MilestonesCard data={milestones} />
        <PointsHistoryCard data={history} />
      </div>

      <PointsRankingCard
        rows={ranking}
        highlightUserId={session.user_id}
        title={rankingTitle}
        breakdownAllowedIds={
          visibleUserIds === null
            ? new Set(ranking.map((r) => r.user_id))
            : new Set(visibleUserIds)
        }
      />

      {breakdown && (
        <PointsBreakdownCard
          data={breakdown}
          isOwn={breakdown.user_id === session.user_id}
        />
      )}

      {sp.breakdown && !breakdown && (
        <p className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-4 text-sm text-warning">
          No puedes ver el desglose de ese usuario. Solo el administrador, el
          director del equipo correspondiente y el propio usuario pueden
          consultar de dónde vienen sus puntos.
        </p>
      )}
    </div>
  );
}
