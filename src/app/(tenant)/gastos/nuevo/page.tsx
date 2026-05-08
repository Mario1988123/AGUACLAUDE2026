import Link from "next/link";
import { listExpenseCategories } from "@/modules/expenses/actions";
import { isMindeeConfigured } from "@/modules/expenses/mindee";
import { NewExpenseForm } from "@/modules/expenses/new-expense-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

interface CustomerRow {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

export default async function NewExpensePage() {
  const session = await requireSession();
  const categories = await listExpenseCategories();

  let customers: { id: string; label: string }[] = [];
  if (session.company_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (await createClient()) as any;
    const { data } = await sb
      .from("customers")
      .select("id, legal_name, trade_name, first_name, last_name")
      .order("created_at", { ascending: false })
      .limit(500);
    customers = ((data as CustomerRow[] | null) ?? []).map((c) => ({
      id: c.id,
      label:
        c.trade_name ||
        c.legal_name ||
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        "(sin nombre)",
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Nuevo gasto</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sube el ticket y rellenamos los datos automáticamente.
          </p>
        </div>
        <BackButton href="/gastos" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del gasto</CardTitle>
        </CardHeader>
        <CardContent>
          <NewExpenseForm
            categories={categories}
            customers={customers}
            ocrEnabled={isMindeeConfigured()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
