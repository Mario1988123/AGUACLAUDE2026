import * as Icons from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: keyof typeof Icons;
  delta?: { value: string; positive?: boolean };
  iconColor?: "primary" | "success" | "warning" | "destructive";
  className?: string;
}

const ICON_BG: Record<NonNullable<KpiCardProps["iconColor"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * KPI Card estilo DashStack — número grande, label, icono circular,
 * delta opcional con indicador de tendencia.
 */
export function KpiCard({
  label,
  value,
  icon = "Activity",
  delta,
  iconColor = "primary",
  className,
}: KpiCardProps) {
  const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    icon
  ] ?? Icons.Activity;
  const TrendIcon = delta?.positive ? Icons.TrendingUp : Icons.TrendingDown;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm shadow-black/[0.02]", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="text-3xl font-extrabold tracking-tight">{value}</div>
        </div>
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", ICON_BG[iconColor])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
      {delta && (
        <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold">
          <TrendIcon
            className={cn("h-4 w-4", delta.positive ? "text-success" : "text-destructive")}
          />
          <span className={delta.positive ? "text-success" : "text-destructive"}>{delta.value}</span>
          <span className="text-muted-foreground">vs mes anterior</span>
        </div>
      )}
    </div>
  );
}
