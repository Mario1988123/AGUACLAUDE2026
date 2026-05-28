import { Mail } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { redirect } from "next/navigation";
import { MailHistoryTable } from "@/modules/mail/mail-history-table";

export const dynamic = "force-dynamic";

const ROLES_WITH_ACCESS = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
  "sales_rep",
  "installer",
  "telemarketer",
];

export default async function MailPage() {
  await assertModuleActive("mail");
  const session = await requireSession();
  if (!session.company_id) redirect("/login");

  // Almacén u otros roles no listados → fuera
  const canSee =
    session.is_superadmin || session.roles.some((r) => ROLES_WITH_ACCESS.includes(r));
  if (!canSee) redirect("/dashboard");

  const isAdmin = session.is_superadmin || session.roles.includes("company_admin");
  const isLevel2 =
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Mail className="h-6 w-6" />
          Mail — Histórico
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Todos los emails enviados desde tu empresa: manuales, automáticos y campañas."
            : isLevel2
              ? "Emails de tu equipo y los enviados automáticamente a sus leads y clientes."
              : "Tus emails y los enviados automáticamente a tus leads y clientes."}
        </p>
      </div>
      <MailHistoryTable isAdmin={isAdmin} />
    </div>
  );
}
