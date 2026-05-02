export const dynamic = "force-dynamic";

import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { Sidebar } from "@/shared/components/sidebar";
import { Header } from "@/shared/components/header";
import { redirect } from "next/navigation";

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userRoles={session.roles}
        isSuperadmin={session.is_superadmin}
        activeModuleKeys={activeModuleKeys}
        fullName={session.full_name}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
      </div>
    </div>
  );
}
