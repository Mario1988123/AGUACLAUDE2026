export const dynamic = "force-dynamic";

import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { Sidebar } from "@/shared/components/sidebar";
import { Header } from "@/shared/components/header";
import { BottomNav, BottomNavSpacer } from "@/shared/components/bottom-nav";
import { getUnreadCount } from "@/modules/notifications/actions";
import { getChatTotalUnread } from "@/modules/chat/actions";
import { hasSeenOnboarding } from "@/modules/onboarding/actions";
import { getStepsForRoles } from "@/modules/onboarding/steps";
import { OnboardingTour } from "@/modules/onboarding/onboarding-tour";
import { redirect } from "next/navigation";

async function getUnreadCountSafe(): Promise<number> {
  try {
    return await getUnreadCount();
  } catch {
    return 0;
  }
}

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  // Superadmin tiene su propio layout
  if (session.is_superadmin) {
    redirect("/superadmin");
  }

  if (!session.company_id) {
    // Usuario invitado pero sin empresa asignada todavía
    redirect("/login?error=no_company");
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companyModules } = await (supabase as any)
    .from("company_modules")
    .select("module_key, is_active")
    .eq("is_active", true);

  const activeModuleKeys = ((companyModules ?? []) as Array<{ module_key: string }>).map(
    (m) => m.module_key,
  );

  const unread = await getUnreadCountSafe();
  const chatUnread = await getChatTotalUnread().catch(() => 0);
  const seenOnboarding = await hasSeenOnboarding().catch(() => true);
  const onboardingSteps = getStepsForRoles(session.roles, session.is_superadmin);

  const ROLE_LABEL: Record<string, string> = {
    company_admin: "Admin",
    technical_director: "Director técnico",
    commercial_director: "Director comercial",
    telemarketing_director: "Director TMK",
    installer: "Instalador",
    sales_rep: "Comercial",
    telemarketer: "Teleoperador",
  };
  const primaryRole = session.is_superadmin
    ? "Superadmin"
    : (session.roles.find((r) => ROLE_LABEL[r]) ?? null);
  const roleLabel = primaryRole ? (ROLE_LABEL[primaryRole] ?? primaryRole) : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userRoles={session.roles}
        isSuperadmin={session.is_superadmin}
        activeModuleKeys={activeModuleKeys}
        fullName={session.full_name}
        badges={{ chat: chatUnread, notifications: unread }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          unreadCount={unread}
          fullName={session.full_name}
          email={session.email}
          roleLabel={roleLabel}
        />
        <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-8">
          {children}
          <BottomNavSpacer />
        </main>
      </div>
      <BottomNav unreadCount={unread} />
      <OnboardingTour steps={onboardingSteps} enabled={!seenOnboarding} />
    </div>
  );
}
