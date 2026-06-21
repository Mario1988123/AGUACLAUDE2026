import { requireSession } from "@/shared/lib/auth/session";
import { MODULES, defaultBottomNavKeysForRoles } from "@/shared/lib/modules";
import { createClient } from "@/shared/lib/supabase/server";
import { getMyModuleOverrides } from "@/modules/tenant/users/permissions-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { MenuMovilForm } from "./menu-movil-form";

export const dynamic = "force-dynamic";

const ALWAYS_ON_GROUPS = new Set<string>(["main", "personal", "system"]);

export default async function MenuMovilConfigPage() {
  const session = await requireSession();

  // Reproducimos la misma lógica de filtrado que el layout/sidebar para que
  // el usuario sólo vea los módulos a los que tiene acceso real.
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
    /* fail-soft */
  }

  let moduleOverrides: Record<string, boolean> = {};
  try {
    moduleOverrides = await getMyModuleOverrides();
  } catch {
    /* fail-soft */
  }

  const availableItems = MODULES.filter((m) => {
    const ov = moduleOverrides[m.key];
    if (ov === false) return false;
    if (ov === true) return true;
    if (!ALWAYS_ON_GROUPS.has(m.group) && !activeModuleKeys.includes(m.key)) return false;
    if (m.rolesAllowed && m.rolesAllowed.length > 0) {
      return m.rolesAllowed.some((r) => session.roles.includes(r));
    }
    return true;
  }).map((m) => ({ key: m.key, label: m.label, icon: m.icon, href: m.href }));

  return (
    <div className="space-y-4">
      <BackButton href="/configuracion" />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Menú del móvil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige qué iconos quieres ver y en qué orden en la barra inferior del móvil.
          Es como ordenar los iconos del escritorio del teléfono — sólo tú lo ves, no
          afecta al resto del equipo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Iconos disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          <MenuMovilForm
            availableItems={availableItems}
            defaultKeys={defaultBottomNavKeysForRoles(session.roles)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
