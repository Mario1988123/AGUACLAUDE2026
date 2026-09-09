import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { DedupeMatch } from "@/shared/lib/dedupe/check-dedupe";
import { isBlockingDuplicate, type PartyKind } from "@/shared/lib/dedupe/rules";

const FIELD_LABEL: Record<DedupeMatch["field"], string> = {
  tax_id: "DNI/CIF",
  email: "email",
  phone: "teléfono",
};

const ENTITY_HREF = (m: DedupeMatch) =>
  m.entity === "lead" ? `/leads/${m.id}` : `/clientes/${m.id}`;

/**
 * `partyKind` = tipo de titular que se está dando de alta. Si se pasa, el aviso
 * distingue las coincidencias que bloquean el alta de las que no (misma persona
 * dándose de alta como empresa: comparte email/teléfono pero es otro titular).
 */
export function DedupeWarning({
  matches,
  partyKind,
}: {
  matches: DedupeMatch[];
  partyKind?: PartyKind;
}) {
  if (matches.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border-2 border-warning bg-warning/10 p-3">
      <div className="flex items-center gap-2 text-sm font-bold text-warning">
        <AlertTriangle className="h-4 w-4" />
        Posible duplicado
      </div>
      <ul className="space-y-1 text-xs">
        {matches.map((m, i) => (
          <li key={`${m.entity}-${m.id}-${m.field}-${i}`}>
            Coincide en <strong>{FIELD_LABEL[m.field]}</strong> con{" "}
            <Link
              href={ENTITY_HREF(m) as never}
              target="_blank"
              className="text-primary hover:underline"
            >
              {m.entity === "lead" ? "lead" : "cliente"} {m.display_name}
            </Link>
            {m.assigned_user_name && (
              <span className="text-muted-foreground"> · asignado a {m.assigned_user_name}</span>
            )}
            {partyKind && !isBlockingDuplicate(m, partyKind) && (
              <span className="text-muted-foreground">
                {" "}
                · no bloquea: es otro tipo de titular (
                {m.party_kind === "company" ? "empresa" : "particular"} ↔{" "}
                {partyKind === "company" ? "empresa" : "particular"})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
