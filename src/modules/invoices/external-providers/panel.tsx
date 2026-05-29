"use client";

import { useState, useTransition } from "react";
import {
  Plug,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Save,
  Zap,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  saveExternalProviderAction,
  testExternalProviderConnectionAction,
  type ProviderSettingsRow,
} from "./actions";
import type { ProviderId, ProviderMeta } from "./types";

interface Props {
  current: ProviderSettingsRow;
  options: ProviderMeta[];
}

/**
 * Panel admin: elige proveedor externo (Verifacti, Invopop, Holded, ...),
 * pega la API key, prueba conexión, guarda. Lo que entres se cifra AES-256
 * en company_settings.
 */
export function ExternalProviderPanel({ current, options }: Props) {
  const [provider, setProvider] = useState<ProviderId>(current.provider);
  const [environment, setEnvironment] = useState<"sandbox" | "production">(
    current.environment,
  );
  const [apiKey, setApiKey] = useState("");
  const [pending, startTransition] = useTransition();
  const meta = options.find((o) => o.id === provider) ?? options[0];

  function save() {
    startTransition(async () => {
      const r = await saveExternalProviderAction({
        provider,
        environment,
        api_key: apiKey.trim() ? apiKey.trim() : null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(
        provider === "none"
          ? "Proveedor desactivado"
          : "Proveedor guardado. Ahora prueba la conexión.",
      );
      setApiKey("");
      location.reload();
    });
  }

  function test() {
    startTransition(async () => {
      const r = await testExternalProviderConnectionAction();
      if (!r.ok) {
        notify.error("Conexión fallida", r.error);
      } else {
        notify.success("Conexión OK", r.message);
      }
      location.reload();
    });
  }

  const isActive = current.provider !== "none";
  const lastTestAge = current.last_test_at
    ? `${Math.floor(
        (Date.now() - new Date(current.last_test_at).getTime()) / 60000,
      )} min`
    : null;

  return (
    <div className="space-y-4">
      {/* Estado actual */}
      {isActive && (
        <div
          className={`rounded-xl border-2 p-3 ${
            current.last_test_ok === true
              ? "border-emerald-300 bg-emerald-50"
              : current.last_test_ok === false
                ? "border-rose-300 bg-rose-50"
                : "border-amber-300 bg-amber-50"
          }`}
        >
          <div className="flex items-start gap-3">
            {current.last_test_ok === true ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            ) : (
              <AlertTriangle
                className={`mt-0.5 h-5 w-5 shrink-0 ${
                  current.last_test_ok === false
                    ? "text-rose-700"
                    : "text-amber-700"
                }`}
              />
            )}
            <div className="flex-1 text-sm">
              <div className="font-bold">
                Conectado a {options.find((o) => o.id === current.provider)?.name ?? current.provider}{" "}
                <Badge variant="secondary" className="ml-2">
                  {current.environment === "production" ? "Producción" : "Sandbox"}
                </Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {current.has_api_key ? "API key guardada (cifrada)" : "Sin API key"}
                {current.last_test_at && (
                  <>
                    {" · Última comprobación hace "}
                    {lastTestAge}
                  </>
                )}
                {current.last_test_ok === false && current.last_test_error && (
                  <>
                    <br />
                    <span className="font-bold text-rose-800">
                      Error: {current.last_test_error}
                    </span>
                  </>
                )}
              </div>
            </div>
            {current.has_api_key && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={test}
              >
                <Zap className="h-4 w-4" />
                Probar
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Selector */}
      <div className="space-y-2">
        <Label>Proveedor externo</Label>
        <div className="grid gap-2">
          {options.map((opt) => (
            <label
              key={opt.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
                provider === opt.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              } ${opt.status === "skeleton" ? "opacity-90" : ""}`}
            >
              <input
                type="radio"
                name="ext_provider"
                value={opt.id}
                checked={provider === opt.id}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-bold">
                  {opt.name}
                  {opt.status === "skeleton" && (
                    <Badge variant="warning" className="text-[10px]">
                      Beta
                    </Badge>
                  )}
                  {opt.id !== "none" && opt.docs_url && (
                    <a
                      href={opt.docs_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="inline h-3 w-3" /> docs
                    </a>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {opt.tagline}
                </div>
                {opt.notes && (
                  <div className="mt-1 text-[11px] italic text-muted-foreground">
                    {opt.notes}
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Credenciales si NO es 'none' */}
      {provider !== "none" && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="space-y-2">
            <Label>Entorno</Label>
            <div className="flex gap-2">
              {(["sandbox", "production"] as const).map((env) => (
                <label
                  key={env}
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-2 p-2 ${
                    environment === env
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="env"
                    value={env}
                    checked={environment === env}
                    onChange={(e) =>
                      setEnvironment(e.target.value as "sandbox" | "production")
                    }
                  />
                  <span className="text-sm">
                    {env === "production" ? "Producción" : "Sandbox / Pruebas"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              API key del proveedor{" "}
              {current.has_api_key && (
                <span className="text-xs font-normal text-muted-foreground">
                  (ya hay una guardada — déjalo en blanco para mantenerla)
                </span>
              )}
            </Label>
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                current.has_api_key
                  ? "Cambiar API key (opcional)"
                  : "Pega aquí tu API key"
              }
            />
            <p className="text-xs text-muted-foreground">
              La guardamos cifrada AES-256-GCM. Nunca se devuelve al cliente.
              {meta?.docs_url && (
                <>
                  {" "}Obtén tu API key en{" "}
                  <a
                    href={meta.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    el panel del proveedor
                  </a>
                  .
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Plug className="mb-1 inline h-3.5 w-3.5" /> Cuando hay proveedor
        externo activo y conectado, las facturas emitidas se EMPUJAN por API
        al proveedor (que se encarga de firma XAdES + envío AEAT). Si la
        conexión falla, la factura queda en el CRM como borrador para
        reintentar.
      </div>
    </div>
  );
}
