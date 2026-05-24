"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Crosshair, MapPin, User, Building2, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  suggestNearbyVisits,
  type NearbySuggestion,
} from "./suggestions-actions";

export function SuggestionsClient() {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [radius, setRadius] = useState(10);
  const [exclude, setExclude] = useState(14);
  const [suggestions, setSuggestions] = useState<NearbySuggestion[]>([]);
  const [pending, startTransition] = useTransition();
  const [gpsLoading, setGpsLoading] = useState(false);

  function useMyGps() {
    if (!navigator.geolocation) {
      notify.warning("Geolocalización no disponible");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setGpsLoading(false);
        searchAt(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setGpsLoading(false);
        notify.error("No se pudo obtener ubicación");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function searchAt(searchLat: number, searchLng: number) {
    startTransition(async () => {
      const r = await suggestNearbyVisits({
        from_lat: searchLat,
        from_lng: searchLng,
        radius_km: radius,
        exclude_recent_days: exclude,
        limit: 30,
      });
      setSuggestions(r);
      if (r.length === 0) {
        notify.info(
          "Sin coincidencias",
          `Nadie sin actividad reciente en ${radius} km a la redonda.`,
        );
      }
    });
  }

  function rerun() {
    if (lat == null || lng == null) {
      notify.warning("Captura primero tu ubicación o introduce coords");
      return;
    }
    searchAt(lat, lng);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button onClick={useMyGps} disabled={gpsLoading || pending}>
              {gpsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crosshair className="h-4 w-4" />
              )}
              Usar mi ubicación
            </Button>
            <div className="space-y-1">
              <Label className="text-xs">Radio (km)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sin actividad ≥ (días)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={exclude}
                onChange={(e) => setExclude(Number(e.target.value))}
                className="w-28"
              />
            </div>
            <Button
              onClick={rerun}
              disabled={pending || lat == null}
              variant="outline"
            >
              Recalcular
            </Button>
          </div>
          {lat != null && lng != null && (
            <p className="text-xs text-muted-foreground">
              📍 Tu posición: {lat.toFixed(5)}, {lng.toFixed(5)} · radio{" "}
              {radius} km · sin contacto hace ≥ {exclude} días
            </p>
          )}
        </CardContent>
      </Card>

      {pending && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!pending && suggestions.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((s) => {
            const Icon = s.kind === "lead" ? User : Building2;
            return (
              <Link
                key={`${s.kind}:${s.id}`}
                href={s.href as never}
                className="group rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate text-sm font-bold">
                        {s.title}
                      </span>
                    </div>
                    {s.subtitle && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <MapPin className="mr-0.5 inline h-3 w-3" />
                        {s.subtitle}
                      </p>
                    )}
                  </div>
                  <Badge variant="default" className="shrink-0 tabular-nums">
                    {s.distance_km.toFixed(1)} km
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{s.kind === "lead" ? "Lead" : "Cliente"}</span>
                  <span>
                    {s.last_activity
                      ? `últ. ${new Date(s.last_activity).toLocaleDateString("es-ES")}`
                      : "sin contacto"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
