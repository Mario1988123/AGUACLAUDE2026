"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveGoCardlessSettingsSafeAction } from "./actions";

export function GoCardlessSettingsForm({
  initial,
}: {
  initial: {
    configured: boolean;
    environment: "sandbox" | "live" | null;
    enabled: boolean;
    hasWebhookSecret: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [environment, setEnvironment] = useState<"sandbox" | "live">(initial.environment ?? "sandbox");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);

  function save() {
    if (!accessToken && !initial.configured) {
      notify.warning("Indica el access token");
      return;
    }
    startTransition(async () => {
      const r = await saveGoCardlessSettingsSafeAction({
        environment,
        access_token: accessToken || "__keep__",
        webhook_secret: webhookSecret || undefined,
        enabled,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Configuración guardada");
      setAccessToken("");
      setWebhookSecret("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Environment</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEnvironment("sandbox")}
            className={`flex-1 rounded-xl border-2 px-4 py-2 text-sm font-bold ${
              environment === "sandbox"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            Sandbox (test)
          </button>
          <button
            type="button"
            onClick={() => setEnvironment("live")}
            className={`flex-1 rounded-xl border-2 px-4 py-2 text-sm font-bold ${
              environment === "live"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-border bg-card hover:border-emerald-300"
            }`}
          >
            Live (producción)
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Access token {initial.configured && <span className="text-xs text-muted-foreground">(deja en blanco para no cambiar)</span>}</Label>
        <Input
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={initial.configured ? "•••••••• (configurado)" : "live_••• o sandbox_•••"}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-2">
        <Label>Webhook secret {initial.hasWebhookSecret && <span className="text-xs text-muted-foreground">(configurado · sobrescribir solo si cambia)</span>}</Label>
        <Input
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder="WHK_••• generado en panel GoCardless"
          autoComplete="off"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="gc-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="gc-enabled" className="cursor-pointer">
          Activado (los comerciales pueden usarlo)
        </Label>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
