import {
  getExpenseSettings,
  listExpenseCategoriesAdmin,
} from "@/modules/expenses/actions";
import { isMindeeConfigured } from "@/modules/expenses/mindee";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ExpenseSettingsForm } from "@/modules/expenses/settings-form";
import { CategoriesManager } from "@/modules/expenses/categories-manager";

export const dynamic = "force-dynamic";

export default async function ExpenseSettingsPage() {
  const [settings, categories] = await Promise.all([
    getExpenseSettings(),
    listExpenseCategoriesAdmin().catch(() => []),
  ]);
  const ocrConfigured = isMindeeConfigured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gastos comerciales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Límites IRPF España, ratio kilometraje, alertas. OCR de tickets vía Mindee.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            OCR de tickets
            {ocrConfigured ? (
              <Badge variant="success">Configurado</Badge>
            ) : (
              <Badge variant="outline">No configurado</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Usamos <strong>Mindee Receipt OCR</strong> para extraer comercio, fecha, importe e IVA del ticket
            automáticamente. Tier gratuito de 250 tickets/mes; superado, $0.01-0.10 por ticket según volumen.
          </p>
          {!ocrConfigured && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="font-bold">Falta configurar MINDEE_API_KEY en Vercel</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  Crea cuenta gratis en{" "}
                  <a className="text-primary underline" href="https://platform.mindee.com/signup" target="_blank" rel="noopener">
                    platform.mindee.com/signup
                  </a>
                </li>
                <li>Ve a API Keys → genera tu key.</li>
                <li>
                  En Vercel → Settings → Environment Variables añade <code>MINDEE_API_KEY</code> con tu key.
                </li>
                <li>Redeploya el proyecto.</li>
              </ol>
              <p className="mt-2 text-xs">
                Sin esto, el módulo funciona pero el comercial debe rellenar los datos a mano.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Límites y reglas</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpenseSettingsForm initial={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorías</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Set base del sector cargado automáticamente (combustible, peajes, parking,
            comidas, hotel, repuestos, EPI, formación…). Puedes añadir, editar o
            desactivar categorías aquí.
          </p>
          <CategoriesManager initial={categories} />
        </CardContent>
      </Card>
    </div>
  );
}
