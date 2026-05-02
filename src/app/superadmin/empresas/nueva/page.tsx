import { NewCompanyForm } from "@/modules/superadmin/companies/new-form";

export const dynamic = "force-dynamic";

export default function NuevaEmpresaPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nueva empresa</h1>
        <p className="text-sm text-muted-foreground">
          Da de alta una empresa tenant. Tras crearla podrás activar/desactivar módulos y crear
          el administrador.
        </p>
      </div>
      <NewCompanyForm />
    </div>
  );
}
