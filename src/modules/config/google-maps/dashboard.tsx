"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Save, KeyRound, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  setGmapsApiKeySafeAction,
  setGmapsFeaturesSafeAction,
  setGmapsAlertEmailSafeAction,
} from "./actions";
import {
  FREE_TIER_USD,
  GMAPS_API_LABEL,
  GMAPS_FEATURE_HINT,
  GMAPS_FEATURE_LABEL,
  type GmapsApi,
  type GmapsFeature,
} from "@/shared/lib/google-maps/pricing";
import type { CompanyGmapsConfig } from "@/shared/lib/google-maps/config";

interface UsageSummary {
  current_month_usd: number;
  current_day_usd: number;
  by_api: Array<{ api: GmapsApi; calls: number; units: number; usd: number }>;
  by_user: Array<{
    user_id: string;
    user_name: string | null;
    calls: number;
    usd: number;
  }>;
  history: Array<{ month: string; usd: number }>;
}

interface Props {
  config: CompanyGmapsConfig;
  usage: UsageSummary;
  /** Indica si la empresa tiene una key configurada (no exponemos la
   *  key real al cliente). Solo informativo. */
  has_key: boolean;
}

const FEATURE_ORDER: GmapsFeature[] = [
  "interactive_maps",
  "smart_routes",
  "directions",
  "static_pdfs",
  "street_view",
  "anti_fraud_roads",
];

export function GoogleMapsDashboard({ config, usage, has_key }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Estado para la API key (modo own_key)
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Toggles de features (estado local optimista)
  const [features, setFeatures] = useState(config.features);

  const [alertEmail, setAlertEmail] = useState(config.alert_email ?? "");

  function saveKey() {
    if (!apiKey.trim()) {
      notify.warning("Pega la API key antes de guardar");
      return;
    }
    startTransition(async () => {
      const r = await setGmapsApiKeySafeAction(apiKey);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("API key guardada (cifrada)");
      setApiKey("");
      router.refresh();
    });
  }

  function clearKey() {
    if (!confirm("¿Borrar la API key? El módulo dejará de funcionar hasta que pongas otra.")) return;
    startTransition(async () => {
      const r = await setGmapsApiKeySafeAction("");
      if (!r.ok) {
        notify.error("No se pudo borrar", r.error);
        return;
      }
      notify.success("API key borrada");
      router.refresh();
    });
  }

  function toggleFeature(key: GmapsFeature) {
    const next = !features[key];
    // Optimista
    setFeatures((f) => ({ ...f, [key]: next }));
    startTransition(async () => {
      const r = await setGmapsFeaturesSafeAction({ [key]: next });
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        setFeatures((f) => ({ ...f, [key]: !next }));
        return;
      }
      notify.success(
        next
          ? `${GMAPS_FEATURE_LABEL[key]} activado`
          : `${GMAPS_FEATURE_LABEL[key]} desactivado`,
      );
    });
  }

  function saveAlertEmail() {
    startTransition(async () => {
      const r = await setGmapsAlertEmailSafeAction(alertEmail);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Email de alertas guardado");
    });
  }

  if (config.mode === "disabled") {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Google Maps Tools no está activado.</p>
            <p className="mt-1">
              El módulo está deshabilitado para tu empresa. Si quieres
              autocompletado profesional, mapas Google, rutas con IA, Street
              View en fichas y demás, contacta con soporte para activarlo.
            </p>
            <p className="mt-2 text-xs">
              Mientras tanto el CRM sigue funcionando con OpenStreetMap como
              hasta ahora.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const usagePct = Math.min(
    100,
    Math.round((usage.current_month_usd * 100) / config.monthly_cap_usd),
  );
  const freePct = Math.min(
    100,
    Math.round((usage.current_month_usd * 100) / FREE_TIER_USD),
  );
  const exceededMonth = usage.current_month_usd >= config.monthly_cap_usd;
  const exceededDay = usage.current_day_usd >= config.daily_cap_usd;

  return (
    <div className="space-y-6">
      {/* Resumen de estado */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Modo:</span>
              <Badge variant={config.mode === "own_key" ? "success" : "warning"}>
                {config.mode === "own_key"
                  ? "Clave propia (pagas tú)"
                  : "Clave compartida (paga la plataforma)"}
              </Badge>
              {has_key ? (
                <Badge variant="default">Operativo</Badge>
              ) : (
                <Badge variant="destructive">Sin key configurada</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tope mensual: ${config.monthly_cap_usd.toFixed(2)} · Tope diario:
              ${config.daily_cap_usd.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* API Key (solo en modo own_key) */}
      {config.mode === "own_key" && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold">API key de Google Cloud</h2>
          </div>
          {has_key ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              ✓ Hay una API key guardada y cifrada. Si quieres sustituirla,
              pega la nueva debajo. Para borrarla, pulsa &laquo;Borrar key&raquo;.
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              No hay API key guardada. Genera una en{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener"
                className="font-bold underline"
              >
                Google Cloud Console
              </a>
              , restringe por referrer a tus dominios y habilita las APIs:
              Places API (New), Maps JavaScript API, Geocoding, Routes, Static
              Maps.
            </div>
          )}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1.5">
              <Label>Nueva API key</Label>
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                autoComplete="off"
                className="font-mono"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowKey((x) => !x)}
              aria-label={showKey ? "Ocultar" : "Mostrar"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button onClick={saveKey} disabled={pending}>
              <Save className="h-4 w-4" />
              Guardar
            </Button>
            {has_key && (
              <Button onClick={clearKey} disabled={pending} variant="ghost" className="text-destructive">
                Borrar key
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            La key se cifra con AES-256-GCM antes de guardarla. Nunca se
            devuelve descifrada al cliente. La factura va a tu tarjeta de
            Google Cloud directamente.
          </p>
        </div>
      )}

      {/* Email de alertas */}
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <Label>Email de alertas (al 80% del free tier)</Label>
        <div className="flex gap-2">
          <Input
            type="email"
            value={alertEmail}
            onChange={(e) => setAlertEmail(e.target.value)}
            placeholder="admin@empresa.com"
            className="flex-1"
          />
          <Button onClick={saveAlertEmail} disabled={pending} variant="outline">
            Guardar
          </Button>
        </div>
      </div>

      {/* Features toggles */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-bold">Funcionalidades premium</h2>
        <p className="text-xs text-muted-foreground">
          Geocoding y autocomplete están activos siempre cuando el módulo está
          activado. Las siguientes son opcionales — actívalas según tu
          presupuesto.
        </p>
        <ul className="space-y-2">
          {FEATURE_ORDER.map((f) => (
            <li
              key={f}
              className="flex items-start justify-between gap-3 rounded-xl border bg-background p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">
                  {GMAPS_FEATURE_LABEL[f]}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {GMAPS_FEATURE_HINT[f]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleFeature(f)}
                disabled={pending || !has_key}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  features[f] ? "bg-success" : "bg-muted"
                } ${!has_key ? "opacity-40 cursor-not-allowed" : ""}`}
                aria-label={features[f] ? "Desactivar" : "Activar"}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    features[f] ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Consumo del mes */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">Consumo este mes</h2>
          <Badge variant={exceededMonth ? "destructive" : "default"}>
            ${usage.current_month_usd.toFixed(2)} / ${config.monthly_cap_usd.toFixed(2)}
          </Badge>
        </div>
        {/* Barra cap */}
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            Tope mensual ({usagePct}%)
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${
                usagePct > 80 ? "bg-destructive" : usagePct > 50 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>
        {/* Barra free tier */}
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            Free tier Google ${FREE_TIER_USD}/mes ({freePct}%)
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${freePct}%` }}
            />
          </div>
        </div>
        {exceededDay && (
          <p className="rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
            ⚠ Tope diario alcanzado. El módulo está cayendo a OSM hasta
            mañana.
          </p>
        )}

        {/* Desglose por API */}
        {usage.by_api.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Por API
            </h3>
            <ul className="divide-y rounded-xl border">
              {usage.by_api.map((r) => (
                <li
                  key={r.api}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>{GMAPS_API_LABEL[r.api] ?? r.api}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.calls.toLocaleString("es-ES")} calls
                  </span>
                  <span className="font-bold tabular-nums">${r.usd.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top usuarios */}
        {usage.by_user.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Top usuarios este mes
            </h3>
            <ul className="divide-y rounded-xl border">
              {usage.by_user.map((u) => (
                <li
                  key={u.user_id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>{u.user_name ?? u.user_id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    {u.calls.toLocaleString("es-ES")} calls
                  </span>
                  <span className="font-bold tabular-nums">${u.usd.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Histórico */}
        {usage.history.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Histórico últimos 6 meses
            </h3>
            <div className="flex items-end gap-2 h-24">
              {usage.history.map((h, i) => {
                const max = Math.max(
                  ...usage.history.map((x) => x.usd),
                  config.monthly_cap_usd * 0.1,
                );
                const heightPct = Math.max(2, (h.usd / max) * 100);
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${h.month}: $${h.usd.toFixed(2)}`}
                  >
                    <div className="text-[10px] tabular-nums font-bold">
                      {h.usd > 0 ? `$${h.usd.toFixed(0)}` : ""}
                    </div>
                    <div
                      className="w-full bg-primary/70 rounded-t hover:bg-primary"
                      style={{ height: `${heightPct}%` }}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {h.month.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
