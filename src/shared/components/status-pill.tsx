import { cn } from "@/shared/lib/utils";

/**
 * Status pill estilo DashStack — tono pastel, texto coloreado, redondeado
 * total. Usar en tablas en lugar de Badge cuando se quiere look DashStack.
 */
type Tone =
  | "success" // Completed (verde)
  | "processing" // Processing (lila)
  | "rejected" // Rejected (rojo suave)
  | "onhold" // On Hold (naranja claro)
  | "transit" // In Transit (rosa)
  | "info" // Default (azul claro)
  | "neutral"; // Gris

const TONE: Record<Tone, string> = {
  success: "bg-[#dcf6e6] text-[#0caf60]",
  processing: "bg-[#e6e6ff] text-[#5a5acf]",
  rejected: "bg-[#ffe1e1] text-[#cf2727]",
  onhold: "bg-[#ffe9c8] text-[#cf8c1a]",
  transit: "bg-[#f4d8ff] text-[#9333ea]",
  info: "bg-[#dde7ff] text-[#3b82f6]",
  neutral: "bg-muted text-muted-foreground",
};

export function StatusPill({
  label,
  tone = "info",
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-3 text-xs font-semibold",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
