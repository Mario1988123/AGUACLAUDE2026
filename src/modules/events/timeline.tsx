import { listSubjectEvents, listCustomerTimeline } from "./actions";
import { TimelineList } from "./timeline-list";

interface Props {
  subjectType: string;
  subjectId: string;
  /** Si true Y subjectType='customer', incluye eventos de contratos,
   *  instalaciones, mantenimientos e incidencias relacionados. */
  enriched?: boolean;
}

export async function Timeline({ subjectType, subjectId, enriched }: Props) {
  const events =
    enriched && subjectType === "customer"
      ? await listCustomerTimeline(subjectId)
      : await listSubjectEvents(subjectType, subjectId);

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin eventos todavía. Aquí aparecerá el historial conforme se trabaje con esta entidad.
      </p>
    );
  }

  return <TimelineList events={events} />;
}
