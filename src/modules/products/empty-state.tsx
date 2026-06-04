"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import {
  importStandardWaterCategoriesAction,
  importStandardServiceLinesAction,
} from "./seed-actions";

interface Props {
  /** True si la sesión actual es admin (nivel 1) o superadmin. */
  canImport: boolean;
}

/**
 * Empty state que aparece en /productos cuando la empresa NO tiene
 * categorías creadas. Le explica al admin que el primer paso es
 * importar el catálogo estándar del sector, y le ofrece hacerlo en
 * un clic. A nivel 2 y 3 le muestra una explicación sin botón (porque
 * no son ellos quienes deben crear el catálogo).
 */
export function ProductsEmptyState({ canImport }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function notify(msg: string, error = false) {
    setMessage(msg);
    setIsError(error);
  }

  function doImportCategories() {
    startTransition(async () => {
      const res = await importStandardWaterCategoriesAction();
      if (res.ok) {
        notify(
          `Categorías importadas: ${res.inserted} nuevas, ${res.skipped} ya existían.`,
        );
        router.refresh();
      } else {
        notify(res.error, true);
      }
    });
  }

  function doImportServices() {
    startTransition(async () => {
      const res = await importStandardServiceLinesAction();
      if (res.ok) {
        notify(
          `Líneas de servicio importadas: ${res.inserted} nuevas, ${res.skipped} ya existían.`,
        );
        router.refresh();
      } else {
        notify(res.error, true);
      }
    });
  }

  return (
    <div className="rounded-2xl border-2 border-dashed bg-card p-8 text-center">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="text-4xl">📦</div>
        <h2 className="text-xl font-bold">
          Antes de crear productos, configura tus categorías
        </h2>
        <p className="text-sm text-muted-foreground">
          Las categorías organizan tu catálogo y determinan qué atributos
          técnicos tendrá cada producto (caudal, dureza, presión, dosis UV...).
          Si quieres, importamos un catálogo estándar del sector del agua y
          empiezas en un minuto. Después podrás renombrarlas, borrarlas o
          añadir las tuyas propias.
        </p>

        {canImport ? (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              onClick={doImportCategories}
              disabled={pending}
            >
              {pending ? "Importando..." : "Importar categorías estándar del agua"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={doImportServices}
              disabled={pending}
            >
              Importar líneas de servicio estándar
            </Button>
          </div>
        ) : (
          <p className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
            El catálogo de productos lo configura el administrador de tu
            empresa. Pídele que entre en esta página y haga la importación
            inicial.
          </p>
        )}

        {message && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              isError
                ? "border border-red-200 bg-red-50 text-red-700"
                : "border border-green-200 bg-green-50 text-green-700"
            }`}
            role={isError ? "alert" : "status"}
          >
            {message}
          </div>
        )}

        <div className="pt-3 text-xs text-muted-foreground">
          ¿Qué incluye el catálogo estándar? Ósmosis (5 etapas, compacta y
          flujo directo), descalcificadores, dispensadores, equipos Horeca,
          ozono, filtros y líneas de servicio.
        </div>
      </div>
    </div>
  );
}
