import { getSavingsConfig, listSavingsBrands } from "@/modules/savings/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { SavingsConfigForm } from "@/modules/savings/config-form";
import { SavingsBrandsManager } from "@/modules/savings/brands-manager";
import { AlertCircle } from "lucide-react";
import { formatDateES } from "@/shared/lib/format-date";

export const dynamic = "force-dynamic";

export default async function CalculadoraAhorroConfigPage() {
  const [config, brands] = await Promise.all([getSavingsConfig(), listSavingsBrands()]);

  // Detectar marcas con scrape fallido recientemente
  const failedBrands = brands.filter((b) => (b.consecutive_failures ?? 0) >= 3);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Calculadora de ahorro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Marcas de agua, parámetros eco y configuración del scraper de precios.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      {failedBrands.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" />
            <div className="flex-1 text-sm text-amber-900">
              <strong>{failedBrands.length} marca{failedBrands.length === 1 ? "" : "s"} con scraper caído:</strong>{" "}
              {failedBrands.map((b) => b.name).join(", ")}. Se está usando el último precio
              guardado. Comprueba el término de búsqueda o pasa la marca a manual.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Parámetros del cálculo</CardTitle>
        </CardHeader>
        <CardContent>
          <SavingsConfigForm initial={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marcas de agua</CardTitle>
        </CardHeader>
        <CardContent>
          <SavingsBrandsManager initial={brands} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de scrapes</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 text-left">Marca</th>
                <th className="py-2 text-left">Fuente</th>
                <th className="py-2 text-left">Última actualización</th>
                <th className="py-2 text-right">Precio actual</th>
                <th className="py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {brands.filter((b) => b.kind === "supermarket").map((b) => {
                const failed = (b.consecutive_failures ?? 0) >= 3;
                return (
                  <tr key={b.id}>
                    <td className="py-2 font-medium">{b.name}</td>
                    <td className="py-2 text-xs">
                      {b.price_source === "manual" ? (
                        <Badge variant="outline">Manual</Badge>
                      ) : (
                        <Badge variant={failed ? "destructive" : "default"}>
                          {b.price_source?.replace("scraper_", "") ?? "—"}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {formatDateES(b.last_scraped_at)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">
                      {b.price_per_liter_cents != null
                        ? `${(b.price_per_liter_cents / 100).toFixed(2)} €/L`
                        : "—"}
                    </td>
                    <td className="py-2 text-xs">
                      {failed ? (
                        <span className="text-amber-700">⚠ Scraper falló {b.consecutive_failures}×</span>
                      ) : (
                        <span className="text-emerald-700">✓ OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
