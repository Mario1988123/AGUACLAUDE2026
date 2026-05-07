"use client";

import { useState, useTransition } from "react";
import { Save, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { setVerifactuModeAction } from "./verifactu-config-actions";

const MODES = [
  {
    value: "no_envio",
    label: "Solo registro local",
    desc: "La factura se firma con hash y QR pero NO se envía a la AEAT. Para empresas que aún no han adoptado Verifactu (antes 2027).",
  },
  {
    value: "verifactu_test",
    label: "Test AEAT (preproducción)",
    desc: "Las facturas se envían al entorno de pruebas de la AEAT. Útil para probar sin afectar al registro fiscal real.",
  },
  {
    value: "verifactu",
    label: "Verifactu producción",
    desc: "Cada factura se envía AUTOMÁTICAMENTE a la AEAT en tiempo real. Requiere certificado FNMT subido.",
  },
];

export function VerifactuModePanel({
  initialMode,
  initialEnvironment,
  certAlias,
  certExpiresAt,
}: {
  initialMode: string;
  initialEnvironment: string;
  certAlias: string | null;
  certExpiresAt: string | null;
}) {
  const [mode, setMode] = useState(initialMode);
  const [pending, startTransition] = useTransition();
  void initialEnvironment;

  function save() {
    startTransition(async () => {
      try {
        await setVerifactuModeAction(
          mode as "no_envio" | "verifactu" | "verifactu_test",
        );
        notify.success("Modo guardado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const certWarning =
    mode !== "no_envio" && (!certAlias || !certExpiresAt);
  const certExpiringSoon =
    certExpiresAt &&
    new Date(certExpiresAt).getTime() - Date.now() < 30 * 86400 * 1000;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
              mode === m.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="verifactu_mode"
              value={m.value}
              checked={mode === m.value}
              onChange={(e) => setMode(e.target.value)}
              className="mt-1"
            />
            <div>
              <div className="font-bold text-sm">{m.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {certWarning && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Falta certificado FNMT.</strong> Para enviar a la AEAT
              necesitas subir el certificado digital de tu empresa (.p12 o
              .pfx). Lo guardamos cifrado AES-256 en BD. La subida del
              certificado se habilitará en próxima iteración.
            </div>
          </div>
        </div>
      )}

      {certAlias && (
        <div
          className={`rounded-xl border-2 p-3 text-xs ${
            certExpiringSoon
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Certificado:</strong> {certAlias}
              {certExpiresAt && (
                <span>
                  {" · Caduca "}
                  {new Date(certExpiresAt).toLocaleDateString("es-ES")}
                </span>
              )}
              {certExpiringSoon && " ⚠ caduca en menos de 30 días"}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar modo"}
        </Button>
      </div>
    </div>
  );
}
