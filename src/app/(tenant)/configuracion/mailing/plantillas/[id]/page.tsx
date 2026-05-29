import { redirect, notFound } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { getTemplateForEditAction } from "@/modules/mailing/actions";
import { TemplateEditor } from "@/modules/mailing/template-editor";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/configuracion/mailing");
  }
  const { id } = await params;
  const template = await getTemplateForEditAction(id).catch(() => null);
  if (!template) notFound();

  return (
    <div className="space-y-6">
      <TemplateEditor template={template} />
    </div>
  );
}
