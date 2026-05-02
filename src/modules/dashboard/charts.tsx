"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface SalesByMonthProps {
  data: { month: string; total_eur: number }[];
}

export function SalesByMonthChart({ data }: SalesByMonthProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ventas (últimos 6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                }}
                formatter={(v: number) => `${v.toFixed(2)} €`}
              />
              <Bar dataKey="total_eur" fill="var(--primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface FunnelProps {
  data: { step: string; count: number }[];
}

export function FunnelChart({ data }: FunnelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel comercial</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.map((step, i) => {
            const max = Math.max(...data.map((d) => d.count));
            const pct = max > 0 ? (step.count / max) * 100 : 0;
            return (
              <div key={step.step}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold">{step.step}</span>
                  <span className="font-bold tabular-nums">{step.count}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: i === data.length - 1 ? "var(--success)" : "var(--primary)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface ComparePieProps {
  data: { name: string; value: number; color: string }[];
}

export function StatusPieChart({ data, title }: ComparePieProps & { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface YearComparisonProps {
  thisYear: { month: string; total_eur: number }[];
  lastYear: { month: string; total_eur: number }[];
}

export function YearComparisonChart({ thisYear, lastYear }: YearComparisonProps) {
  const merged = thisYear.map((p, i) => ({
    month: p.month,
    "Este año": p.total_eur,
    "Año anterior": lastYear[i]?.total_eur ?? 0,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparativa anual</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="Este año" stroke="var(--primary)" strokeWidth={3} />
              <Line type="monotone" dataKey="Año anterior" stroke="var(--muted-foreground)" strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
