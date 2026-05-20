"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Crosshair, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateUserHomeLocationAction } from "./home-location-actions";

interface Props {
  userId?: string;
  initialLat: number | null;
  initialLng: number | null;
  initialLabel?: string | null;
  /** Si el editor lo abre el propio usuario en su perfil. */
  isOwn?: boolean;
}

export function HomeLocationEditor({
  userId,
  initialLat,
  initialLng,
  initialLabel,
  isOwn,
}: Props) {
  const [lat, setLat] = useState<string>(
    initialLat != null ? String(initialLat) : "",
  );
  const [lng, setLng] = useState<string>(
    initialLng != null ? String(initialLng) : "",
  );
  const [label, setLabel] = useState<string>(initialLabel ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function useCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.error("Geolocalización no disponible");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        notify.success("Posición capturada", "Revisa y pulsa Guardar.");
      },
      (err) => {
        notify.error("No se pudo obtener tu ubicación", err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function save() {
    const latNum = lat.trim() ? parseFloat(lat.replace(",", ".")) : null;
    const lngNum = lng.trim() ? parseFloat(lng.replace(",", ".")) : null;
    if (lat.trim() && Number.isNaN(latNum)) {
      notify.error("Latitud no es numérica");
      return;
    }
    if (lng.trim() && Number.isNaN(lngNum)) {
      notify.error("Longitud no es numérica");
      return;
    }
    startTransition(async () => {
      const r = await updateUserHomeLocationAction({
        user_id: userId,
        latitude: latNum,
        longitude: lngNum,
        address_label: label.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Punto de partida guardado");
      router.refresh();
    });
  }

  const mapsUrl =
    lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-primary" />
          {isOwn ? "Mi punto de partida" : "Punto de partida del usuario"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {isOwn
            ? "Tu casa o lugar desde donde sales por las mañanas. Se usa para calcular el orden óptimo de tus instalaciones en /mi-día."
            : "El sistema usa estas coordenadas para calcular rutas óptimas al técnico."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Latitud</Label>
            <Input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="40.416775"
            />
          </div>
          <div className="space-y-1">
            <Label>Longitud</Label>
            <Input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="-3.703790"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Etiqueta (opcional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Casa, Sevilla"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={useCurrentLocation}
            disabled={pending}
            className="gap-1.5"
          >
            <Crosshair className="h-4 w-4" />
            Usar mi ubicación actual
          </Button>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-border bg-card px-2.5 text-xs hover:bg-muted"
            >
              <MapPin className="h-3.5 w-3.5" /> Ver en Maps
            </a>
          )}
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={pending}
            className="ml-auto gap-1.5"
          >
            <Save className="h-4 w-4" />
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
