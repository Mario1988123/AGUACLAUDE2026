/**
 * Chip del modelo de equipo: «Fuente · Infinity Basic · FIORD» o
 * «Ósmosis · pendiente de identificar» (ámbar). Sin estado: vale en server y
 * client components.
 */
export function ChipModeloEquipo({
  etiqueta,
  pendiente,
  tipo,
  className = "",
}: {
  etiqueta: string;
  pendiente: boolean;
  tipo: "fuente" | "osmosis" | null;
  className?: string;
}) {
  const color = pendiente
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : tipo === "osmosis"
      ? "border-teal-200 bg-teal-50 text-teal-900"
      : tipo === "fuente"
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : "border-border bg-muted text-foreground";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${color} ${className}`}
    >
      <span className="truncate">{etiqueta}</span>
    </span>
  );
}
