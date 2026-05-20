"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Crosshair,
  Camera,
  PenLine,
  CheckCircle2,
  X,
  Warehouse,
  AlertTriangle,
  Sparkles,
  Play,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  startInstallationAction,
  finishInstallationAction,
} from "./wizard-actions";
import {
  uploadInstallationPhotoAction,
  saveInstallationSignatureAction,
  type InstallationPhoto,
} from "./client-actions";

interface Warehouse {
  id: string;
  name: string;
  is_used_default: boolean;
}

interface Props {
  installationId: string;
  status: string;
  photos: InstallationPhoto[];
  customerName: string;
  scheduledAt?: string | null;
  /** Warehouses disponibles como destino (sugerido: la furgoneta del técnico) */
  warehouses: Warehouse[];
}

type Step = 1 | 2 | 3 | 4 | 5;

const STATES = [
  { value: "operative", label: "Operativo", color: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  { value: "damaged", label: "Dañado", color: "border-red-300 bg-red-50 text-red-900" },
  { value: "needs_review", label: "Para revisar", color: "border-amber-300 bg-amber-50 text-amber-900" },
];

export function UninstallWizard({
  installationId,
  status: initialStatus,
  photos: initPhotos,
  customerName,
  scheduledAt,
  warehouses,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [status, setStatus] = useState(initialStatus);
  const [photos, setPhotos] = useState<InstallationPhoto[]>(initPhotos);
  const [equipState, setEquipState] = useState<string>("operative");
  const [customerDamage, setCustomerDamage] = useState(false);
  const [damageDesc, setDamageDesc] = useState("");
  const [retrievalNotes, setRetrievalNotes] = useState("");
  const [signerName, setSignerName] = useState(customerName);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [destWarehouse, setDestWarehouse] = useState<string>(
    warehouses.find((w) => w.is_used_default)?.id ?? warehouses[0]?.id ?? "",
  );

  function reset() {
    setOpen(false);
    setStep(1);
  }

  function startParte() {
    if (!scheduledAt) {
      notify.warning("Esta retirada no está agendada");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      callStart(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => callStart(pos.coords.latitude, pos.coords.longitude),
      () => callStart(null, null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function callStart(lat: number | null, lng: number | null) {
    startTransition(async () => {
      const r = await startInstallationAction({
        installation_id: installationId,
        geo_lat: lat,
        geo_lng: lng,
      });
      if (!r.ok) {
        notify.error("No se pudo iniciar", r.error);
        return;
      }
      setStatus("in_progress");
      notify.success("Retirada iniciada");
      setStep(2);
    });
  }

  function uploadPhoto(file: File, category: "equipment" | "damage" | "extra") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("installation_id", installationId);
    fd.append("category", category);
    startTransition(async () => {
      const r = await uploadInstallationPhotoAction(fd);
      if (!r.ok) {
        notify.error("No se pudo subir", r.error);
        return;
      }
      setPhotos((cur) => [r.photo, ...cur]);
      notify.success("Foto subida");
    });
  }

  async function saveSignature() {
    if (!signatureData || !signerName.trim()) {
      notify.warning("Falta firma y/o nombre");
      return;
    }
    const r = await saveInstallationSignatureAction({
      installation_id: installationId,
      signer_role: "customer",
      signer_name: signerName.trim(),
      signer_tax_id: null,
      signature_data_url: signatureData,
      context: "final",
    });
    if (!r.ok) {
      notify.error("No se pudo guardar firma", r.error);
      return false;
    }
    return true;
  }

  function finishUninstall() {
    if (!signatureData) {
      notify.warning("El cliente debe firmar la hoja de retirada");
      return;
    }
    if (!destWarehouse) {
      notify.warning("Selecciona el almacén destino del equipo");
      return;
    }
    startTransition(async () => {
      const sigOk = await saveSignature();
      if (!sigOk) return;
      const notesFinal = [
        `[RETIRADA] Estado equipo: ${equipState}`,
        customerDamage ? `Desperfecto del cliente: ${damageDesc || "sin detalle"}` : null,
        retrievalNotes ? `Notas: ${retrievalNotes}` : null,
        `Destino: warehouse ${destWarehouse}`,
      ]
        .filter(Boolean)
        .join("\n");
      const r = await finishInstallationAction({
        installation_id: installationId,
        satisfaction_score: null,
        satisfaction_comment: null,
        notes: notesFinal,
      });
      if (!r.ok) {
        notify.error("No se pudo cerrar la retirada", r.error);
        return;
      }
      notify.success("Retirada completada");
      reset();
      router.push("/instalaciones");
    });
  }

  const stepLabels: Record<Step, string> = {
    1: "Iniciar",
    2: "Estado al retirar",
    3: "Fotos",
    4: "Firma cliente",
    5: "Destino",
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="warning" className="gap-2">
        <Sparkles className="h-4 w-4" /> Abrir parte de retirada
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex h-full w-full flex-col bg-card">
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <div>
                <h2 className="text-base font-bold">Parte de retirada</h2>
                <p className="truncate text-xs text-muted-foreground">{customerName}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="rounded-full p-2 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/20 px-3 py-3 text-xs">
              {([1, 2, 3, 4, 5] as Step[]).map((n) => (
                <div
                  key={n}
                  className={`flex flex-1 min-w-0 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 font-bold ${
                    step === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : step > n
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {n}. {stepLabels[n]}
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {step === 1 && (
                <div className="space-y-4">
                  <p className="text-sm">
                    Pulsa <strong>Iniciar retirada</strong> para capturar tu
                    posición GPS y empezar el parte de retirada del equipo.
                  </p>
                  {status === "in_progress" ? (
                    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                      ✓ Retirada ya iniciada. Continúa al paso 2.
                    </div>
                  ) : (
                    <Button
                      onClick={startParte}
                      disabled={pending}
                      className="w-full"
                      variant="warning"
                      size="lg"
                    >
                      <Play className="h-4 w-4" /> Iniciar retirada (capturar GPS)
                    </Button>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Marca el estado del equipo al retirarlo + si hay
                    desperfectos provocados por el cliente.
                  </p>
                  <div className="space-y-1">
                    <Label>Estado del equipo</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {STATES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setEquipState(s.value)}
                          className={`rounded-xl border-2 p-3 text-left transition ${
                            equipState === s.value
                              ? s.color
                              : "border-border bg-card hover:bg-muted/30"
                          }`}
                        >
                          <div className="font-bold">{s.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-start gap-2 rounded-xl border-2 border-amber-200 bg-amber-50 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customerDamage}
                      onChange={(e) => setCustomerDamage(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="text-sm">
                      <strong className="text-amber-900">
                        ⚠ El cliente ha provocado desperfectos al equipo
                      </strong>
                      <p className="text-xs text-amber-800">
                        Marca esto si hay daños no atribuibles al uso normal
                        (golpes, modificaciones, falta piezas).
                      </p>
                    </div>
                  </label>
                  {customerDamage && (
                    <textarea
                      rows={3}
                      value={damageDesc}
                      onChange={(e) => setDamageDesc(e.target.value)}
                      placeholder="Describe el desperfecto (tipo, ubicación, valoración estimada…)"
                      className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 p-2 text-sm"
                    />
                  )}
                  <Button onClick={() => setStep(3)} className="w-full">
                    Siguiente
                  </Button>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Sube fotos del equipo retirado, del estado en que queda
                    el sitio y de los desperfectos (si hay).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <PhotoBtn label="Equipo retirado" category="equipment" onPick={uploadPhoto} />
                    <PhotoBtn label="Cómo queda" category="extra" onPick={uploadPhoto} />
                    <PhotoBtn label="Desperfecto" category="damage" onPick={uploadPhoto} />
                  </div>
                  {photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {photos.map((p) => (
                        <div
                          key={p.id}
                          className="relative aspect-square overflow-hidden rounded-lg border"
                        >
                          {p.signed_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.signed_url}
                              alt={p.category}
                              className="h-full w-full object-cover"
                            />
                          )}
                          <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                            {p.category === "equipment"
                              ? "Equipo"
                              : p.category === "damage"
                                ? "Daño"
                                : "Otra"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    onClick={() => setStep(4)}
                    disabled={photos.length === 0}
                    className="w-full"
                  >
                    Siguiente (sube al menos una foto)
                  </Button>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Hoja de retirada — firma del cliente conforme con la
                    devolución del equipo.
                  </p>
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <strong>Declaración del cliente:</strong> El cliente
                    declara conforme con la retirada del equipo en el estado
                    indicado en el paso 2, sin reclamación posterior.
                  </div>
                  <div className="space-y-1">
                    <Label>Nombre del firmante</Label>
                    <Input
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </div>
                  <UninstallSignaturePad onChange={setSignatureData} />
                  <Button
                    onClick={() => setStep(5)}
                    disabled={!signatureData || !signerName.trim()}
                    className="w-full"
                  >
                    Siguiente
                  </Button>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Indica a dónde va el equipo retirado.
                  </p>
                  <div className="space-y-1">
                    <Label>Almacén destino</Label>
                    <div className="space-y-2">
                      {warehouses.length === 0 ? (
                        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                          No hay almacenes configurados. Pide al admin que
                          cree al menos uno.
                        </p>
                      ) : (
                        warehouses.map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => setDestWarehouse(w.id)}
                            className={`flex w-full items-center justify-between rounded-xl border-2 p-3 text-left transition ${
                              destWarehouse === w.id
                                ? "border-primary bg-primary/5"
                                : "border-border bg-card hover:bg-muted/30"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Warehouse className="h-4 w-4" />
                              <span className="font-semibold">{w.name}</span>
                            </div>
                            {w.is_used_default && (
                              <Badge variant="success">Recomendado (Usados)</Badge>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Notas finales (opcional)</Label>
                    <textarea
                      rows={2}
                      value={retrievalNotes}
                      onChange={(e) => setRetrievalNotes(e.target.value)}
                      placeholder="Observaciones de la retirada…"
                      className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                    />
                  </div>
                  <Button
                    onClick={finishUninstall}
                    disabled={pending || !destWarehouse}
                    variant="success"
                    size="lg"
                    className="w-full"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {pending ? "Cerrando…" : "Completar retirada"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PhotoBtn({
  label,
  category,
  onPick,
}: {
  label: string;
  category: "equipment" | "damage" | "extra";
  onPick: (file: File, cat: "equipment" | "damage" | "extra") => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border bg-card p-3 hover:border-primary/40"
      >
        <Camera className="h-5 w-5 text-primary" />
        <span className="text-[11px] font-bold">{label}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f, category);
          e.target.value = "";
        }}
      />
    </>
  );
}

function UninstallSignaturePad({ onChange }: { onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    function pos(e: MouseEvent | TouchEvent) {
      const r = c!.getBoundingClientRect();
      const isTouch = "touches" in e;
      const x = isTouch ? e.touches[0]!.clientX : (e as MouseEvent).clientX;
      const y = isTouch ? e.touches[0]!.clientY : (e as MouseEvent).clientY;
      return { x: ((x - r.left) * c!.width) / r.width, y: ((y - r.top) * c!.height) / r.height };
    }
    function start(e: MouseEvent | TouchEvent) {
      e.preventDefault();
      drawing.current = true;
      const p = pos(e);
      ctx!.beginPath();
      ctx!.moveTo(p.x, p.y);
    }
    function move(e: MouseEvent | TouchEvent) {
      if (!drawing.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx!.lineTo(p.x, p.y);
      ctx!.stroke();
    }
    function end() {
      if (!drawing.current) return;
      drawing.current = false;
      onChange(c!.toDataURL("image/png"));
    }
    c.addEventListener("mousedown", start);
    c.addEventListener("mousemove", move);
    c.addEventListener("mouseup", end);
    c.addEventListener("mouseleave", end);
    c.addEventListener("touchstart", start, { passive: false });
    c.addEventListener("touchmove", move, { passive: false });
    c.addEventListener("touchend", end);
    return () => {
      c.removeEventListener("mousedown", start);
      c.removeEventListener("mousemove", move);
      c.removeEventListener("mouseup", end);
      c.removeEventListener("mouseleave", end);
      c.removeEventListener("touchstart", start);
      c.removeEventListener("touchmove", move);
      c.removeEventListener("touchend", end);
    };
  }, [onChange]);
  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={500}
        height={150}
        className="w-full touch-none rounded-xl border-2 border-dashed border-border bg-white"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const c = ref.current;
          if (!c) return;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          onChange(null);
        }}
      >
        Limpiar
      </Button>
    </div>
  );
}
