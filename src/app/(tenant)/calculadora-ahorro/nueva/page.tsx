import {
  getSavingsConfig,
  listSavingsBrands,
  listWizardExtras,
  listWizardProducts,
} from "@/modules/savings/actions";
import { SavingsWizard } from "@/modules/savings/wizard";
import { BackButton } from "@/shared/components/back-button";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";

export const dynamic = "force-dynamic";

export default async function CalculadoraAhorroPage({
  searchParams,
}: {
  searchParams: Promise<{ lead_id?: string; customer_id?: string }>;
}) {
  // Gating: si el módulo no está activo en la empresa, no permitir el wizard
  // (la página de listado ya lo hacía; ésta se saltaba la comprobación).
  await assertModuleActive("savings_calculator");
  const sp = await searchParams;

  const [config, brands, productsHomeRental, productsHomeRenting, productsHomeCash, productsOfficeRental, productsOfficeRenting, productsOfficeCash, extrasRental, extrasRenting, extrasCash] = await Promise.all([
    getSavingsConfig(),
    listSavingsBrands(),
    listWizardProducts({ client_type: "home", plan_type: "rental" }).catch(() => []),
    listWizardProducts({ client_type: "home", plan_type: "renting" }).catch(() => []),
    listWizardProducts({ client_type: "home", plan_type: "cash" }).catch(() => []),
    listWizardProducts({ client_type: "office", plan_type: "rental" }).catch(() => []),
    listWizardProducts({ client_type: "office", plan_type: "renting" }).catch(() => []),
    listWizardProducts({ client_type: "office", plan_type: "cash" }).catch(() => []),
    listWizardExtras({ plan_type: "rental" }).catch(() => []),
    listWizardExtras({ plan_type: "renting" }).catch(() => []),
    listWizardExtras({ plan_type: "cash" }).catch(() => []),
  ]);

  // Unimos productos por client_type. El wizard filtra después por plan elegido.
  const homeProducts = mergeUnique([productsHomeRental, productsHomeRenting, productsHomeCash]);
  const officeProducts = mergeUnique([productsOfficeRental, productsOfficeRenting, productsOfficeCash]);
  const extras = mergeUnique([extrasRental, extrasRenting, extrasCash]);

  // Resolver nombre del lead (si viene)
  let leadName: string | null = null;
  if (sp.lead_id) {
    try {
      const { getLead } = await import("@/modules/leads/actions");
      const l = await getLead(sp.lead_id);
      leadName =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Lead"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Lead";
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Calculadora de ahorro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compara el coste actual del cliente con tu propuesta y muéstrale el ahorro.
          </p>
        </div>
        <BackButton href={leadName ? `/leads/${sp.lead_id}` : "/dashboard"} />
      </div>

      <SavingsWizard
        initialBrands={brands}
        initialProducts={{ home: homeProducts, office: officeProducts }}
        initialExtras={extras}
        config={config}
        defaultLeadId={sp.lead_id ?? null}
        defaultCustomerId={sp.customer_id ?? null}
        defaultLeadName={leadName}
      />
    </div>
  );
}

function mergeUnique<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      // Mergear pricing si es WizardProduct o WizardExtra
      const existing = map.get(item.id);
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = existing as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = item as any;
        if (Array.isArray(a.pricing) && Array.isArray(b.pricing)) {
          // dedupe pricing por (plan_type, duration_months)
          const key = (p: { plan_type: string; duration_months: number | null }) =>
            `${p.plan_type}-${p.duration_months ?? "x"}`;
          const seen = new Set(a.pricing.map(key));
          for (const p of b.pricing) {
            if (!seen.has(key(p))) {
              a.pricing.push(p);
              seen.add(key(p));
            }
          }
        }
      } else {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values());
}
