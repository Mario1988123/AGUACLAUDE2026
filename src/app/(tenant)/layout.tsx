export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { requireSession, enforcePasswordChange } from "@/shared/lib/auth/session";
import { MODULES } from "@/shared/lib/modules";
import { createClient } from "@/shared/lib/supabase/server";
import { Sidebar } from "@/shared/components/sidebar";
import { Header } from "@/shared/components/header";
import { BottomNav, BottomNavSpacer } from "@/shared/components/bottom-nav";
import { getUnreadCount } from "@/modules/notifications/actions";
import { getChatTotalUnread } from "@/modules/chat/actions";
import { hasSeenOnboarding } from "@/modules/onboarding/actions";
import { getMyModuleOverrides } from "@/modules/tenant/users/permissions-actions";
import { getStepsForRoles } from "@/modules/onboarding/steps";
import { OnboardingTour } from "@/modules/onboarding/onboarding-tour";
import { ShiftReminders } from "@/modules/time-tracking/shift-reminders";
import { ReportErrorButton } from "@/modules/error-reports/report-button";
import { redirect } from "next/navigation";

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  technical_director: "Director técnico",
  commercial_director: "Director comercial",
  telemarketing_director: "Director TMK",
  installer: "Instalador",
  sales_rep: "Comercial",
  telemarketer: "Teleoperador",
};

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Si el admin de empresa entró con la contraseña temporal del super,
  // forzamos cambio antes de cualquier otra cosa.
  enforcePasswordChange(session);

  // Superadmin tiene su propio layout (redirect lanza NEXT_REDIRECT, NO capturar)
  if (session.is_superadmin) {
    redirect("/superadmin");
  }

  if (!session.company_id) {
    redirect("/login?error=no_company");
  }

  // Guard de scope por rol: si el usuario intenta acceder por URL directa
  // a un módulo que no tiene asignado en su rol (sales_rep entrando en
  // /instalaciones, telemarketer entrando en /clientes, etc.), lo
  // redirigimos al dashboard. Niveles 1 (company_admin) siempre pasan.
  if (!session.roles.includes("company_admin")) {
    try {
      const h = await headers();
      const pathname =
        h.get("x-invoke-path") ||
        h.get("next-url") ||
        h.get("x-pathname") ||
        "";
      if (pathname) {
        const matched = MODULES.find(
          (m) => m.href !== "/" && (pathname === m.href || pathname.startsWith(`${m.href}/`)),
        );
        if (matched?.rolesAllowed && matched.rolesAllowed.length > 0) {
          const ok = session.roles.some((r) => matched.rolesAllowed!.includes(r));
          if (!ok) {
            redirect("/dashboard");
          }
        }
      }
    } catch (e) {
      // headers() puede fallar en edge cases, no bloquear el render por esto
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("NEXT_REDIRECT")) throw e;
    }
  }

  // Resto de queries: tolerantes a fallos. Si una migración no está aplicada
  // o un servicio externo cae, el layout se renderiza igualmente con valores
  // neutros y el error queda solo en el área correspondiente.
  let activeModuleKeys: string[] = [];
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: companyModules } = await (supabase as any)
      .from("company_modules")
      .select("module_key, is_active")
      .eq("is_active", true);
    activeModuleKeys = ((companyModules ?? []) as Array<{ module_key: string }>).map(
      (m) => m.module_key,
    );
  } catch {
    /* fail-soft: sidebar no podrá filtrar por módulos activos */
  }

  const [unread, chatUnread, seenOnboarding, moduleOverrides] = await Promise.all([
    safe(getUnreadCount(), 0),
    safe(getChatTotalUnread(), 0),
    safe(hasSeenOnboarding(), true),
    safe(getMyModuleOverrides(), {} as Record<string, boolean>),
  ]);

  let onboardingSteps: ReturnType<typeof getStepsForRoles> = [];
  try {
    onboardingSteps = getStepsForRoles(session.roles, session.is_superadmin);
  } catch {
    /* fail-soft */
  }

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
        moduleOverrides={moduleOverrides}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          unreadCount={unread}
          fullName={session.full_name}
          email={session.email}
          roleLabel={roleLabel}
          showTimeClock={activeModuleKeys.includes("time_tracking")}
        />
        <main className="flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-8">
          {children}
          <BottomNavSpacer />
        </main>
      </div>
      <BottomNav unreadCount={unread} />
      <OnboardingTour steps={onboardingSteps} enabled={!seenOnboarding} />
      <ShiftReminders enabled={activeModuleKeys.includes("time_tracking")} />
      <ReportErrorButton />
    </div>
  );
}
