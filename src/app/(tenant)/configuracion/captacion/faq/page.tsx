import { redirect } from "next/navigation";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { obtenerDatosFaq } from "@/modules/captacion/asistente-actions";
import { PantallaFaq } from "@/modules/captacion/faq-ui";

export const dynamic = "force-dynamic";

/** FAQ, documentos y chat de prueba del asistente (plan §6.5). Gestores editan; comerciales leen. */
export default async function FaqCaptacionPage() {
  await assertCaptacionActiva();
  const datos = await obtenerDatosFaq();
  if (!datos) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Lo que sabe el asistente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {datos.ia.activa
            ? "El asistente de WhatsApp contesta con estas preguntas, estos documentos y los equipos de cada campaña."
            : "El asistente de WhatsApp está apagado. Puedes preparar las respuestas y probarlo antes de encenderlo."}
        </p>
      </div>
      <PantallaFaq datos={datos} />
    </div>
  );
}
