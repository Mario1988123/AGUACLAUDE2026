import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { AlertTriangle, Scale, Bell } from "lucide-react";
import {
  listPendingLegalNotices,
  listResolvedLegalNotices,
} from "@/modules/time-tracking/legal-notices-actions";
import { LegalNoticeButtons } from "@/modules/time-tracking/legal-notice-buttons";

export const dynamic = "force-dynamic";

interface LegalRight {
  kind: string;
  label: string;
  amount: string;
  base: string;
  base_year: number;
  notes?: string;
  changed_recently?: boolean;
}

/**
 * Tabla de referencia con los permisos legales españoles, días/semanas
 * y base legal. Cuando haya una reforma, hay que actualizar:
 *   1. Este array con la nueva cifra.
 *   2. DEFAULT_BUDGETS_2026 en absence-labels.ts.
 *   3. Bumpear LAST_REVIEWED_AT para resetear la alerta de revisión.
 */
const LAST_REVIEWED_AT = "2026-05-18";
const REVIEW_INTERVAL_MONTHS = 12;

const LEGAL_RIGHTS: LegalRight[] = [
  {
    kind: "vacation",
    label: "Vacaciones",
    amount: "30 días naturales (≈22 laborables)",
    base: "Estatuto de los Trabajadores Art. 38",
    base_year: 1995,
    notes:
      "Mínimo legal. El convenio colectivo puede mejorar pero no empeorar. Algunos convenios usan horas anuales.",
  },
  {
    kind: "maternity",
    label: "Maternidad (nacimiento y cuidado de menor)",
    amount: "19 semanas (32 si familia monoparental)",
    base: "RD-ley 9/2025 (Art. 48.4 ET)",
    base_year: 2025,
    changed_recently: true,
    notes:
      "Reforma 2025: 19 semanas totales (antes 16). Estructura: 6 semanas obligatorias e ininterrumpidas tras el parto + 11 flexibles hasta los 12 meses + 2 flexibles hasta que el menor cumpla 8 años. Retribuidas al 100% de la base reguladora. Familias monoparentales: 32 semanas (6 obl + 22 hasta 12m + 4 hasta 8 años).",
  },
  {
    kind: "paternity",
    label: "Paternidad (nacimiento y cuidado de menor)",
    amount: "19 semanas (32 si familia monoparental)",
    base: "RD-ley 9/2025 (Art. 48.4 ET, equiparado)",
    base_year: 2025,
    changed_recently: true,
    notes:
      "Equiparado en duración y retribución a maternidad. Mismas 6 semanas obligatorias post-nacimiento + 11 hasta 12 meses + 2 hasta 8 años. 100% base reguladora.",
  },
  {
    kind: "parental_paid_8y",
    label: "Permiso parental retribuido (hasta 8 años)",
    amount: "2 semanas",
    base: "RD-ley 9/2025 (Art. 48.4 ET — incluidas en las 19)",
    base_year: 2025,
    changed_recently: true,
    notes:
      "Las 2 semanas finales del permiso de nacimiento, disfrutables hasta los 8 años del menor. Ya no son un permiso aparte: forman parte de las 19 semanas totales del Art. 48.4 ET. Retribuidas al 100%. Disfrute efectivo desde 1 enero 2026 incluso para hijos nacidos desde el 2 de agosto de 2024.",
  },
  {
    kind: "parental_unpaid_8y",
    label: "Permiso parental no retribuido (hasta 8 años)",
    amount: "6 semanas",
    base: "RD-ley 7/2024 + Art. 48 bis ET (Directiva UE 2019/1158)",
    base_year: 2024,
    notes:
      "Permiso adicional NO retribuido (no se descuenta el sueldo, no hay prestación Seg. Social). Antes eran 8 semanas — desde el RD-ley 9/2025 las 2 retribuidas pasan al permiso de nacimiento, quedando 6 sin remuneración. Disfrutable continuo o fraccionado hasta los 8 años.",
  },
  {
    kind: "lactation",
    label: "Lactancia",
    amount: "1 hora/día hasta 9 meses",
    base: "ET Art. 37.4",
    base_year: 1995,
    notes:
      "Reducción de jornada de 1 hora diaria (o 30 min al inicio y 30 min al final) hasta que el menor cumpla 9 meses. Acumulable en jornadas completas según convenio.",
  },
  {
    kind: "marriage",
    label: "Permiso matrimonio / pareja de hecho",
    amount: "15 días naturales",
    base: "ET Art. 37.3 a)",
    base_year: 1995,
    notes:
      "Equiparados matrimonio y pareja de hecho registrada (RD-ley 5/2023).",
  },
  {
    kind: "bereavement",
    label: "Fallecimiento / accidente grave familiar 2º grado",
    amount: "5 días laborables",
    base: "RD-ley 5/2023 (ET Art. 37.3 b)",
    base_year: 2023,
    notes:
      "Hasta 2º grado de consanguinidad o afinidad. Antes eran 2-4 días según parentesco.",
  },
  {
    kind: "mudanza",
    label: "Mudanza domicilio habitual",
    amount: "1 día",
    base: "ET Art. 37.3 c)",
    base_year: 1995,
  },
  {
    kind: "civic_duty",
    label: "Cumplimiento deber inexcusable",
    amount: "El tiempo necesario",
    base: "ET Art. 37.3 d)",
    base_year: 1995,
    notes:
      "Votar, citación judicial, deberes públicos. No tiene tope predefinido en días.",
  },
  {
    kind: "sick",
    label: "Incapacidad temporal (baja médica)",
    amount: "Sin tope anual",
    base: "LGSS + ET Art. 45",
    base_year: 1994,
    notes:
      "Días 1-3 sin retribución (salvo convenio). Días 4-15 al 60% (a cargo empresa). Días 16-20 al 60% (Seg Soc). Día 21+ al 75%. Hasta 365 días + posible prórroga 180.",
  },
];

const RECENT_REFORMS = [
  {
    year: 2025,
    title: "RD-ley 9/2025 — Ampliación permiso de nacimiento y cuidado de menor",
    summary:
      "Permiso por nacimiento pasa de 16 a 19 semanas por cada progenitor (BOE 30/07/2025, en vigor 31/07/2025). Estructura: 6 semanas obligatorias post-parto + 11 flexibles hasta 12 meses + 2 flexibles hasta los 8 años. Familias monoparentales: 32 semanas (6+22+4). Retribución 100% base reguladora. Aplica a nacimientos desde el 2 de agosto de 2024, pero el disfrute efectivo de las 2 nuevas semanas solo se puede solicitar a partir del 1 de enero de 2026. Completa transposición Directiva UE 2019/1158.",
  },
  {
    year: 2024,
    title: "RD-ley 7/2024 — Permiso parental retribuido",
    summary:
      "Primera transposición de la Directiva UE 2019/1158: 2 de las 8 semanas del permiso parental pasan a ser retribuidas. El RD-ley 9/2025 absorbe esas 2 semanas dentro del permiso de nacimiento (Art. 48.4 ET).",
  },
  {
    year: 2023,
    title: "RD-ley 5/2023 — Conciliación familiar",
    summary:
      "Permiso por fallecimiento de familiar 2º grado: 5 días laborables (antes 2-4 según parentesco). Equiparación matrimonio/pareja de hecho.",
  },
  {
    year: 2019,
    title: "RD-ley 6/2019 — Equiparación permisos parentales",
    summary:
      "Paternidad equiparada a maternidad en duración (16 semanas), eliminando la brecha histórica. Ampliada después por el RD-ley 9/2025 a 19 semanas.",
  },
];

export default async function LeyesPage() {
  await assertModuleActive("time_tracking");
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin) redirect("/fichajes" as never);

  const [pendingNotices, resolvedNotices] = await Promise.all([
    listPendingLegalNotices().catch(() => []),
    listResolvedLegalNotices().catch(() => []),
  ]);

  const lastReviewed = new Date(LAST_REVIEWED_AT);
  const monthsSinceReview = Math.round(
    (Date.now() - lastReviewed.getTime()) / (30 * 86400000),
  );
  const overdue = monthsSinceReview > REVIEW_INTERVAL_MONTHS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <Scale className="h-7 w-7" /> Marco legal de permisos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Referencia de los días, semanas y horas que la ley española
            reconoce para cada permiso laboral. Última revisión:{" "}
            <strong>{lastReviewed.toLocaleDateString("es-ES")}</strong>.
          </p>
        </div>
        <BackButton href="/fichajes/admin" />
      </div>

      {pendingNotices.length > 0 && (
        <Card className="border-blue-300 bg-blue-50">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Bell className="h-4 w-4 text-blue-700" />
            <CardTitle className="text-blue-900">
              Avisos BOE pendientes de revisar ({pendingNotices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              El cron mensual detectó estas publicaciones del BOE que podrían
              afectar a permisos o vacaciones. Abre el enlace, revisa si tu
              empresa debe actualizar valores y márcalo como revisado o
              descártalo si no aplica.
            </p>
            <ul className="space-y-3">
              {pendingNotices.map((n) => (
                <li key={n.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">
                          {n.boe_id ?? "BOE"}
                        </Badge>
                        {n.boe_date && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {new Date(n.boe_date).toLocaleDateString("es-ES")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold">{n.title}</p>
                      {n.keywords_matched && (
                        <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                          Coincidió con: {n.keywords_matched}
                        </p>
                      )}
                      {n.url && (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
                        >
                          Abrir en BOE →
                        </a>
                      )}
                    </div>
                    <LegalNoticeButtons noticeId={n.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {overdue && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <div className="text-sm text-amber-900">
              <strong>Aviso de revisión legal</strong>
              <p className="mt-0.5">
                Hace {monthsSinceReview} meses que no se revisan estos valores.
                Comprueba en el BOE (www.boe.es) si hay un nuevo RD-ley o
                modificación del Estatuto de los Trabajadores que afecte a los
                permisos. Si actualizas, edita{" "}
                <code className="rounded bg-amber-100 px-1">
                  src/modules/time-tracking/absence-labels.ts
                </code>{" "}
                y la constante <code>LAST_REVIEWED_AT</code> en esta página.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Permisos y duraciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left">Permiso</th>
                  <th className="py-2 text-left">Duración</th>
                  <th className="py-2 text-left">Base legal</th>
                  <th className="py-2 text-center">Año</th>
                </tr>
              </thead>
              <tbody>
                {LEGAL_RIGHTS.map((r) => (
                  <tr key={r.kind} className="border-b align-top last:border-0">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{r.label}</span>
                        {r.changed_recently && (
                          <Badge variant="warning" className="text-[10px]">
                            Nuevo {r.base_year}
                          </Badge>
                        )}
                      </div>
                      {r.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-mono text-sm tabular-nums">
                      {r.amount}
                    </td>
                    <td className="py-3 pr-3 text-xs">{r.base}</td>
                    <td className="py-3 text-center tabular-nums">{r.base_year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reformas recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {RECENT_REFORMS.map((r) => (
              <li key={r.year} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{r.year}</Badge>
                  <strong className="text-sm">{r.title}</strong>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.summary}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cómo funciona la detección automática</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Un cron mensual revisa el RSS de Disposiciones Generales del BOE
            buscando publicaciones que contengan keywords como{" "}
            <em>permiso, vacaciones, parental, lactancia, conciliación,
            Estatuto Trabajadores</em>.
          </p>
          <p>
            Cuando aparece una coincidencia, se inserta arriba como aviso
            pendiente y se notifica a admin/director. <strong>El sistema NO
            aplica el cambio automáticamente</strong> — el admin revisa el
            BOE, valora si afecta a tu empresa y actualiza
            <code className="mx-1 rounded bg-muted px-1">absence-labels.ts</code>
            si toca. Después marca el aviso como revisado.
          </p>
        </CardContent>
      </Card>

      {resolvedNotices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de avisos resueltos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {resolvedNotices.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {n.boe_id ?? "BOE"}
                      </Badge>
                      {n.boe_date && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {new Date(n.boe_date).toLocaleDateString("es-ES")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs">{n.title}</p>
                  </div>
                  <Badge variant={n.reviewed_at ? "success" : "secondary"}>
                    {n.reviewed_at ? "Revisado" : "Descartado"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
