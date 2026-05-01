import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.is_superadmin) redirect("/");

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-16 items-center border-b px-4 font-semibold">
          AGUACLAUDE · Admin
        </div>
        <nav className="flex-1 space-y-1 p-2">
          <Link
            href="/superadmin"
            className="block rounded px-3 py-2 text-sm hover:bg-muted"
          >
            Empresas
          </Link>
          <Link
            href="/superadmin/catalogo"
            className="block rounded px-3 py-2 text-sm hover:bg-muted"
          >
            Catálogo global
          </Link>
        </nav>
        <div className="border-t p-3">
          <Link href="/logout" className="text-sm text-muted-foreground hover:underline">
            Salir
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
    </div>
  );
}
