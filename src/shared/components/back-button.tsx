import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Botón "Volver" reutilizable. Sustituye al `<Link>← Volver</Link>` que
 * había suelto por todo el CRM. Más visible, tap-friendly en móvil.
 */
export function BackButton({
  href,
  label = "Volver",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href as never}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted hover:border-primary/40 transition-colors"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
