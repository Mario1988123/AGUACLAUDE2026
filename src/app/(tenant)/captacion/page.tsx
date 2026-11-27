import Link from "next/link";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import { assertCaptacionActiva, esEquipoCaptacion, puedeLeerConfig } from "@/modules/captacion/guard";
import { obtenerEstadoCaptacion } from "@/modules/captacion/conexion-actions";
import { listarConversaciones } from "@/modules/captacion/bandeja-actions";
import { datosMando } from "@/modules/captacion/mando-servidor";
import { PanelMando } from "@/modules/captacion/mando-ui";
import { StatusPill } from "@/shared/components/status-pill";
import { Button } from "@/shared/ui/button";

export const dynamic = "force-dynamic";

/**
 * Entrada del módulo: bandeja (fase 2), estado del número y campañas. El
 * mando completo (fases 3 y 7) se monta aquí.
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
  // Fase 8: bloqueos y FAQ del asistente, para quien puede verlos.
  const veEquipo = esEquipoCaptacion(session);
  const estado = veConfig ? await obtenerEstadoCaptacion() : null;
  if (veConfig && !estado) redirect("/dashboard");
  const c = estado?.conexion ?? null;
  const bandeja = await listarConversaciones("todas");
  const sinLeer = (bandeja?.conversaciones ?? []).filter((x) => x.noLeidos > 0).length;
  // Fase 7: embudo, gasto del mes y pausas, solo para quien gestiona.
  const mando = veConfig ? await datosMando(session.company_id, null) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Captación</h1>

      <Link
        href={"/captacion/bandeja" as never}
        className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50 active:bg-muted sm:p-5"
      >
        <span className="font-bold">Bandeja de WhatsApp</span>
        {sinLeer > 0 ? (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold tabular-nums text-primary-foreground">
            {sinLeer} {sinLeer === 1 ? "conversación sin leer" : "conversaciones sin leer"}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Al día</span>
        )}
      </Link>

      {veEquipo ? (
        <nav aria-label="Más de captación" className="grid gap-3 sm:grid-cols-2">
          <Link
            href={"/captacion/bloqueos" as never}
            className="flex min-h-14 flex-col justify-center gap-0.5 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted sm:px-5"
          >
            <span className="font-medium">Bloqueos</span>
            <span className="text-sm text-muted-foreground">A quién no se escribe</span>
          </Link>
          <Link
            href={"/configuracion/captacion/faq" as never}
            className="flex min-h-14 flex-col justify-center gap-0.5 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted sm:px-5"
          >
            <span className="font-medium">FAQ del asistente</span>
            <span className="text-sm text-muted-foreground">Lo que sabe y cómo contesta</span>
          </Link>
        </nav>
      ) : null}

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

      {mando ? <PanelMando datos={mando} /> : null}
    </div>
  );
}
