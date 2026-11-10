import { requireSesionPortal } from "@/modules/portal-clientes/sesion";
import { CambiarClavePortalForm } from "@/modules/portal-clientes/clave-form";

export default async function PortalClavePage() {
  const sesion = await requireSesionPortal();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Cambiar contraseña</h1>
        <p className="text-sm text-muted-foreground">
          Tu usuario es <strong className="text-foreground">{sesion.usuario}</strong>. Elige una
          contraseña de al menos 10 caracteres que no uses en otro sitio.
        </p>
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <CambiarClavePortalForm />
      </div>
    </div>
  );
}
