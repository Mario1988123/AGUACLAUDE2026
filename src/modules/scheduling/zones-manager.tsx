"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  MapPin,
  Pencil,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  upsertServiceZoneAction,
  deleteServiceZoneAction,
  setSchedulingSettingsAction,
  type ServiceZoneRow,
  type SchedulingSettings,
} from "./zones-actions";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // 0..6

interface Props {
  initialZones: ServiceZoneRow[];
  initialSettings: SchedulingSettings;
}

export function ZonesManager({ initialZones, initialSettings }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<ServiceZoneRow | "new" | null>(null);

  return (
    <div className="space-y-6">
      <SettingsPanel initial={initialSettings} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Zonas de servicio</CardTitle>
          <Button size="sm" className="gap-1" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Nueva zona
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Define en qué días cubres cada zona. Cuando un cliente pida cambiar
            la fecha de su instalación, solo se le ofrecerán días de su zona en
            los que además haya hueco de técnico y la ruta cuadre. Si no defines
            zonas, se ofrecen todos los días laborables con hueco.
          </p>

          {editing && (
            <ZoneForm
              zone={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}

          {initialZones.length === 0 && !editing && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Aún no hay zonas. Crea la primera con &quot;Nueva zona&quot;.
            </p>
          )}

          <div className="space-y-2">
            {initialZones.map((z) => (
              <ZoneRow
                key={z.id}
                zone={z}
                onEdit={() => setEditing(z)}
                onDeleted={() => router.refresh()}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ZoneRow({
  zone,
  onEdit,
  onDeleted,
}: {
  zone: ServiceZoneRow;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  function del() {
    if (!confirm(`¿Eliminar la zona "${zone.name}"?`)) return;
    start(async () => {
      const r = await deleteServiceZoneAction(zone.id);
      if (r.ok) onDeleted();
      else alert(r.error);
    });
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="font-medium">{zone.name}</span>
          {!zone.active && (
            <Badge variant="outline" className="text-[10px]">
              Inactiva
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {zone.weekdays.map((w) => (
            <span
              key={w}
              className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
            >
              {WEEKDAYS[w]}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            · CP {zone.postal_prefixes.join(", ")}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit} className="gap-1">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={del}
          disabled={pending}
          className="gap-1 text-rose-600 hover:text-rose-700"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function ZoneForm({
  zone,
  onClose,
  onSaved,
}: {
  zone: ServiceZoneRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [prefixes, setPrefixes] = useState(
    (zone?.postal_prefixes ?? []).join(", "),
  );
  const [weekdays, setWeekdays] = useState<number[]>(zone?.weekdays ?? []);
  const [active, setActive] = useState(zone?.active ?? true);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function toggleDay(d: number) {
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  }

  function save() {
    setError("");
    const prefixList = prefixes
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    start(async () => {
      const r = await upsertServiceZoneAction({
        id: zone?.id ?? null,
        name: name.trim(),
        postal_prefixes: prefixList,
        weekdays,
        active,
      });
      if (r.ok) onSaved();
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nombre de la zona</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Costa norte"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Códigos postales (o prefijos)</Label>
          <Input
            value={prefixes}
            onChange={(e) => setPrefixes(e.target.value)}
            placeholder="15300, 1503, 15001"
          />
          <p className="text-[11px] text-muted-foreground">
            Separados por comas. Puedes usar prefijos (ej. 153 cubre 15300-15399).
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Días que cubres esta zona</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => toggleDay(idx)}
              className={`h-10 w-12 rounded-lg border text-sm font-bold transition ${
                weekdays.includes(idx)
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-white text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4"
        />
        Zona activa
      </label>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar zona
        </Button>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function SettingsPanel({ initial }: { initial: SchedulingSettings }) {
  const [jobsPerSlot, setJobsPerSlot] = useState(String(initial.jobs_per_slot));
  const [offerWeeks, setOfferWeeks] = useState(String(initial.offer_weeks));
  const [radiusKm, setRadiusKm] = useState(String(initial.radius_km));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  function save() {
    setResult(null);
    start(async () => {
      const r = await setSchedulingSettingsAction({
        jobs_per_slot: parseInt(jobsPerSlot) || 2,
        offer_weeks: parseInt(offerWeeks) || 4,
        radius_km: parseInt(radiusKm) || 15,
      });
      setResult(
        r.ok
          ? { ok: true, message: "Ajustes guardados" }
          : { ok: false, message: r.error },
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Límites de la agenda</CardTitle>
        <p className="text-sm text-muted-foreground">
          Reglas que aplica el sistema al ofrecer fechas al cliente.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Trabajos por franja</Label>
            <Input
              type="number"
              value={jobsPerSlot}
              onChange={(e) => setJobsPerSlot(e.target.value)}
              min={1}
            />
            <p className="text-[11px] text-muted-foreground">
              Máximo por técnico en mañana o tarde.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Semanas a ofrecer</Label>
            <Input
              type="number"
              value={offerWeeks}
              onChange={(e) => setOfferWeeks(e.target.value)}
              min={1}
              max={12}
            />
            <p className="text-[11px] text-muted-foreground">
              Hasta dónde mira hacia delante.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Radio de ruta (km)</Label>
            <Input
              type="number"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              min={1}
            />
            <p className="text-[11px] text-muted-foreground">
              Distancia máx. a otro trabajo del día.
            </p>
          </div>
        </div>

        {result && (
          <div
            className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
              result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {result.ok ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {result.message}
          </div>
        )}

        <Button onClick={save} disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar ajustes
        </Button>
      </CardContent>
    </Card>
  );
}
