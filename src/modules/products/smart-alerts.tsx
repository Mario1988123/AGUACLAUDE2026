import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  AlertTriangle,
  TrendingDown,
  PackageX,
  ImageOff,
  EyeOff,
} from "lucide-react";

export interface ProductAlerts {
  active_no_price: number;
  negative_margin: number;
  in_calc_no_stock: number;
  no_photo: number;
}

export function ProductSmartAlerts({ alerts }: { alerts: ProductAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.active_no_price > 0)
    items.push({
      key: "no_price",
      label: "Activos sin precio configurado",
      value: alerts.active_no_price,
      icon: AlertTriangle,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/productos",
    });
  if (alerts.negative_margin > 0)
    items.push({
      key: "neg_margin",
      label: "Margen negativo (precio < coste)",
      value: alerts.negative_margin,
      icon: TrendingDown,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/productos",
    });
  if (alerts.in_calc_no_stock > 0)
    items.push({
      key: "no_stock_calc",
      label: "En calculadora pero sin stock",
      value: alerts.in_calc_no_stock,
      icon: PackageX,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/productos",
    });
  if (alerts.no_photo > 0)
    items.push({
      key: "no_photo",
      label: "Sin foto principal",
      value: alerts.no_photo,
      icon: ImageOff,
      color: "border-slate-300 bg-slate-50 text-slate-900",
      href: "/productos",
    });

  if (items.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Catálogo en buen estado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-5 w-5" />
          Avisos del catálogo
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.key}
                href={it.href as never}
                className={`flex items-center gap-3 rounded-xl border-2 p-3 hover:opacity-80 ${it.color}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-extrabold tabular-nums">{it.value}</div>
                  <div className="text-xs">{it.label}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export async function getProductAlerts(): Promise<ProductAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: ProductAlerts = {
    active_no_price: 0,
    negative_margin: 0,
    in_calc_no_stock: 0,
    no_photo: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Activos sin precio configurado (cash_price_cents NULL o 0).
  try {
    const { count } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .or("cash_price_cents.is.null,cash_price_cents.eq.0");
    out.active_no_price = count ?? 0;
  } catch {
    /* */
  }

  // Margen negativo (cash_price_cents < cost_cents)
  try {
    const { data: prods } = await admin
      .from("products")
      .select("id, cash_price_cents, cost_cents")
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .not("cash_price_cents", "is", null)
      .not("cost_cents", "is", null);
    out.negative_margin = ((prods ?? []) as Array<{
      cash_price_cents: number;
      cost_cents: number;
    }>).filter((p) => p.cash_price_cents < p.cost_cents).length;
  } catch {
    /* */
  }

  // En calculadora pero sin stock en NINGÚN almacén
  try {
    const { data: inCalc } = await admin
      .from("products")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .eq("show_in_calculator", true);
    const calcIds = ((inCalc ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (calcIds.length > 0) {
      const { data: stock } = await admin
        .from("warehouse_stock")
        .select("product_id, quantity")
        .in("product_id", calcIds)
        .gt("quantity", 0);
      const withStock = new Set(
        ((stock ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
      );
      out.in_calc_no_stock = calcIds.filter((id) => !withStock.has(id)).length;
    }
  } catch {
    /* */
  }

  // Sin foto principal (photo_url NULL)
  try {
    const { count } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .is("photo_url", null);
    out.no_photo = count ?? 0;
  } catch {
    /* tabla puede no tener photo_url */
  }

  return out;
}
