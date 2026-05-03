import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { MonthlyEvolutionRow } from "./evolution-actions";

interface Props {
  data: MonthlyEvolutionRow[];
  metric: "sales_cents" | "contracts" | "leads";
  title: string;
}

const W = 720;
const H = 220;
const PAD_L = 50;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

function formatValue(v: number, metric: Props["metric"]): string {
  if (metric === "sales_cents") {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v / 100);
  }
  return String(v);
}

/**
 * Gráfico SVG inline (sin dependencias) de evolución 12 meses. Renderiza
 * barras + línea suavizada y muestra delta vs mes anterior.
 */
export function EvolutionChart({ data, metric, title }: Props) {
  if (data.length === 0) return null;
  const values = data.map((d) => d[metric]);
  const maxV = Math.max(1, ...values);
  const last = values[values.length - 1] ?? 0;
  const prev = values[values.length - 2] ?? 0;
  const delta = last - prev;
  const deltaPct = prev > 0 ? (delta / prev) * 100 : last > 0 ? 100 : 0;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const barWidth = innerW / data.length;
  const stepX = innerW / Math.max(1, data.length - 1);

  function x(i: number): number {
    return PAD_L + i * stepX;
  }
  function y(v: number): number {
    return PAD_T + innerH - (v / maxV) * innerH;
  }

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[metric]).toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * maxV);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{title}</span>
          <span
            className={`text-xs font-bold ${
              delta >= 0 ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}% vs mes anterior
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ maxHeight: 260 }}
            role="img"
            aria-label={title}
          >
            {/* Grid */}
            {yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD_L - 6}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="currentColor"
                  fillOpacity={0.5}
                >
                  {formatValue(t, metric)}
                </text>
              </g>
            ))}
            {/* Barras */}
            {data.map((d, i) => {
              const v = d[metric];
              const h = (v / maxV) * innerH;
              return (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2 + 4}
                  y={PAD_T + innerH - h}
                  width={Math.max(2, barWidth - 8)}
                  height={h}
                  rx={3}
                  fill="#4880FF"
                  fillOpacity={0.18}
                />
              );
            })}
            {/* Línea */}
            <path d={linePath} fill="none" stroke="#4880FF" strokeWidth={2} />
            {/* Puntos */}
            {data.map((d, i) => (
              <circle key={i} cx={x(i)} cy={y(d[metric])} r={3} fill="#4880FF" />
            ))}
            {/* Etiquetas X */}
            {data.map((d, i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.6}
              >
                {d.label}
              </text>
            ))}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
