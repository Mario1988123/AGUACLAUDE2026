export const dynamic = "force-dynamic";

import { requireSession, enforcePasswordChange } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { SuperadminShell } from "./_shell";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.is_superadmin) redirect("/");
  // Si el superadmin tuviese también marcado must_change_password
  // (poco común porque se crea por SQL, pero defensivo), también lo
  // mandamos a cambiar contraseña.
  enforcePasswordChange(session);

  return <SuperadminShell email={session.email}>{children}</SuperadminShell>;
}
