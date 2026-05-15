import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { getMyClockExtended } from "@/modules/time-tracking/actions";
import { getMyHourBalance } from "@/modules/time-tracking/balance";
import { BackButton } from "@/shared/components/back-button";
import { PunchPageClient } from "@/modules/time-tracking/punch-page-client";

export const dynamic = "force-dynamic";

export default async function FicharPage() {
  await assertModuleActive("time_tracking");
  const session = await requireSession();

  const today = new Date().toISOString().slice(0, 10);
  const [state, balance] = await Promise.all([
    getMyClockExtended(),
    getMyHourBalance(today, today).catch(() => []),
  ]);

  const todayRow = balance[0];
  const worked = todayRow?.worked_minutes ?? 0;
  const expected = todayRow?.expected_minutes ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Fichar</h1>
        <BackButton href="/fichajes" />
      </div>
      <PunchPageClient
        userName={session.full_name ?? session.email ?? "Usuario"}
        initialState={state}
        todayWorkedMinutes={worked}
        todayExpectedMinutes={expected}
      />
    </div>
  );
}
