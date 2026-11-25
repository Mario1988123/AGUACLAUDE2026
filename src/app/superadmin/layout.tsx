export const dynamic = "force-dynamic";

import { requireSession, enforcePasswordChange } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { SuperadminShell } from "./_shell";
import { empresasParaCambiar, puedeCambiarDeEmpresa } from "@/modules/superadmin/entrar-como";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.is_superadmin) redirect("/");
  // Si el superadmin tuviese también marcado must_change_password
  // (poco común porque se crea por SQL, pero defensivo), también lo
  // mandamos a cambiar contraseña.
  enforcePasswordChange(session);

  // «Cambiar a:» arriba: entrar en cualquier empresa como su admin.
  let empresas: Awaited<ReturnType<typeof empresasParaCambiar>> = [];
  try {
    if (await puedeCambiarDeEmpresa(session, null)) empresas = await empresasParaCambiar();
  } catch {
    /* fail-soft: sin selector */
  }

  return (
    <SuperadminShell email={session.email} empresas={empresas}>
      {children}
    </SuperadminShell>
  );
}
