import Link from "next/link";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import { assertCaptacionActiva, puedeLeerConfig } from "@/modules/captacion/guard";
import { obtenerEstadoCaptacion } from "@/modules/captacion/conexion-actions";
import { StatusPill } from "@/shared/components/status-pill";
import { Button } from "@/shared/ui/button";

export const dynamic = "force-dynamic";

/**
 * Entrada del módulo. En la fase 1 solo enseña el estado del número; la
 * bandeja (fase 2) y el mando de campañas (fases 3 y 7) se montan aquí.
 */
export default async function CaptacionPage() {
  const session = await assertCaptacionActiva();
  requireModuleAccess(session, [
    "commercial_director",
    "telemarketing_director",
    "technical_director",
    "sales_rep",
    "telemarketer",
  ]);
  const veConfig = puedeLeerConfig(session);
  const estado = veConfig ? await obtenerEstadoCaptacion() : null;
  if (veConfig && !estado) redirect("/dashboard");
  const c = estado?.conexion ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Captación</h1>

      {veConfig ? (
        <section className="space-y-3 rounded-xl border border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold">{c?.numero_e164 ?? "Sin número conectado"}</span>
            {c?.estado === "activa" ? (
              <StatusPill label="Conectado" tone="success" />
            ) : (
              <StatusPill label="Sin conectar" tone="neutral" />
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="h-12">
              <Link href={"/captacion/campanas" as never}>Campañas y negocios</Link>
            </Button>
            <Button asChild variant="outline" className="h-12">
              <Link href={"/configuracion/captacion" as never}>Configurar el número</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Las conversaciones aparecerán aquí cuando esté lista la bandeja.
      </p>
    </div>
  );
}
