"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InstallationAidsPanel } from "./installation-aids-panel";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardList,
  Coins,
  Crosshair,
  Pause,
  Play,
  PenLine,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
  AlertTriangle,
  Smile,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  startInstallationAction,
  pauseInstallationAction,
  resumeInstallationAction,
  reportInstallationIncidentAction,
  setInstallationItemSerialAction,
  setInstallationInitialStateAction,
  finishInstallationAction,
  updateContractMaintenanceScheduleAction,
} from "./wizard-actions";
import {
  uploadInstallationPhotoAction,
  saveInstallationSignatureAction,
  type InstallationItem,
  type InstallationPhoto,
  type InstallationSignature,
} from "./client-actions";
import { CollectInline } from "@/modules/contracts/quick-collect-inline";
import { MaintenancePlanPicker } from "@/modules/maintenance-plans/plan-picker";
import type { MaintenancePlan } from "@/modules/maintenance-plans/actions";

interface PaymentRow {
  id: string;
  concept: string;
  amount_cents: number;
  method: string;
  moment: string;
  status: string;
}

interface Props {
  installationId: string;
  status: string;
  startedAt: string | null;
  hasPreviousDamage: boolean;
  needsCountertopDrilling: boolean;
  items: Array<InstallationItem & { product_name: string }>;
  photos: InstallationPhoto[];
  signatures: InstallationSignature[];
  payments: PaymentRow[];
  customerName: string;
  customerTaxId: string | null;
  representativeName: string;
  /** ID del cliente para crear contrato de mantenimiento al final */
  customerId: string | null;
  /** ID del contrato principal asociado */
  contractId: string | null;
  /** Catálogo de planes de mantenimiento disponibles */
  maintenancePlans: MaintenancePlan[];
  /** true si el contrato principal YA incluye mantenimiento */
  contractIncludesMaintenance: boolean;
  /** Periodicidad (en meses) configurada en el contrato. Default 6. */
  contractMaintenancePeriodicityMonths?: number | null;
  /** Meses totales cubiertos por el mantenimiento. Default duration_months. */
  contractMaintenanceMonthsIncluded?: number | null;
  /** Duración total del contrato en meses (fallback para meses cubiertos). */
  contractDurationMonths?: number | null;
  /** Solo admin/director puede editar cobros ya validados/cobrados. */
  canEditCollectedPayments?: boolean;
  /** Estado del contrato — usado para bloquear el wizard si no está firmado. */
  contractStatus?: string;
  /** Plan del contrato (cash/rental/renting) — para decidir si ofrecer
   *  contrato de mantenimiento separado al cerrar instalación. */
  contractPlanType?: "cash" | "rental" | "renting" | null;
  /** Datos extra del cliente para mostrar quién es y dónde se instala (decisión usuario 2026-05-11). */
  customerPhone?: string | null;
  customerEmail?: string | null;
  installationAddress?: string | null;
  /** Fecha y hora programada — para bloquear el inicio si no es el día actual. */
  scheduledAt?: string | null;
  /** true si la instalación tiene una incidencia abierta sin resolver
   *  (p. ej. stock_shortage). Bloquea iniciar parte (decisión 2026-05-19). */
  hasOpenIncident?: boolean;
  /** Tipo de la orden: 'install' (default) o 'uninstall' (retirada de
   *  prueba gratuita o equipo alquilado). Si es uninstall, el wizard
   *  oculta cobros y encuesta de satisfacción y cambia textos a "retirada". */
  kind?: "install" | "uninstall";
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: Array<{ n: Step; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { n: 1, label: "Iniciar", icon: Play },
  { n: 2, label: "Estado inicial", icon: ClipboardList },
  { n: 3, label: "Cobros", icon: Coins },
  { n: 4, label: "Equipos y fotos", icon: Wrench },
  { n: 5, label: "Firma + encuesta", icon: PenLine },
  { n: 6, label: "Cerrar", icon: CheckCircle2 },
];

const PAUSE_REASONS: Array<{ value: string; label: string }> = [
  { value: "lunch", label: "Almuerzo" },
  { value: "to_warehouse", label: "Al almacén" },
  { value: "to_buy", label: "A comprar" },
  { value: "end_of_day", label: "Fin de jornada" },
  { value: "other", label: "Otro" },
];

const INCIDENT_KINDS: Array<{ value: string; label: string }> = [
  { value: "stock_shortage", label: "Stock insuficiente (no hay equipo)" },
  { value: "missing_material", label: "Falta material auxiliar (tornillos, tubos…)" },
  { value: "wrong_equipment", label: "Equipo equivocado" },
  { value: "broken_equipment", label: "Equipo roto / defectuoso" },
  { value: "customer_issue", label: "Problema con el cliente" },
  { value: "other", label: "Otro" },
];

const FACES = [
  { v: 1, emoji: "😡", label: "Muy mal" },
  { v: 2, emoji: "😟", label: "Mal" },
  { v: 3, emoji: "😐", label: "Regular" },
  { v: 4, emoji: "🙂", label: "Bien" },
  { v: 5, emoji: "😄", label: "Genial" },
];

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function InstallationWizard(props: Props) {
  const {
    installationId,
    status: initialStatus,
    startedAt,
    hasPreviousDamage: initDamage,
    needsCountertopDrilling: initDrill,
    items,
    photos: initPhotos,
    signatures,
    payments,
    customerName,
    customerTaxId,
    representativeName,
    customerId,
    contractId,
    maintenancePlans,
    contractIncludesMaintenance,
    contractMaintenancePeriodicityMonths,
    contractMaintenanceMonthsIncluded,
    contractDurationMonths,
    canEditCollectedPayments = false,
    contractStatus,
    contractPlanType,
    customerPhone,
    customerEmail,
    installationAddress,
    scheduledAt,
    hasOpenIncident,
    kind = "install",
  } = props;
  const isUninstall = kind === "uninstall";
  void representativeName;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(initialStatus === "scheduled" ? 1 : 2);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // === ESTADO LOCAL ===
  const [status, setStatus] = useState(initialStatus);
  const [hasPreviousDamage, setHasPreviousDamage] = useState(initDamage);
  const [needsCountertopDrilling, setNeedsCountertopDrilling] = useState(initDrill);
  const [photos, setPhotos] = useState<InstallationPhoto[]>(initPhotos);

  // Cronómetro
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<string | null>(startedAt);
  useEffect(() => {
    startedAtRef.current = startedAt;
  }, [startedAt]);
  useEffect(() => {
    if (status !== "in_progress" || !startedAtRef.current) return;
    const tick = () => {
      const ms = Date.now() - new Date(startedAtRef.current!).getTime();
      setElapsed(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  // Pausa modal
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState<string>("lunch");
  const [pauseNotes, setPauseNotes] = useState("");
  const [pauseScheduledAt, setPauseScheduledAt] = useState("");

  // Incidencia modal
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentKind, setIncidentKind] = useState<string>("stock_shortage");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [incidentUnschedule, setIncidentUnschedule] = useState(false);

  // Firma + encuesta
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [satisfactionComment, setSatisfactionComment] = useState("");
  const [signerName, setSignerName] = useState(customerName);
  const [signerTaxId, setSignerTaxId] = useState(customerTaxId ?? "");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [finishNotes, setFinishNotes] = useState("");
  // Firma final ya persistida en BD (al ir de paso 5 → 6 con botón
  // "Guardar y continuar"). Persiste si el usuario vuelve atrás al
  // paso 5 — antes el canvas se quedaba en blanco y parecía perdida.
  const [finalSignatureSaved, setFinalSignatureSaved] = useState(
    Boolean(signatures.find((s) => s.signer_role === "customer" && s.context === "final")),
  );
  const [savingSignature, setSavingSignature] = useState(false);

  // Estado inicial: si hay daño/agujero pedir firma del cliente AHORA
  const [initialSignerName, setInitialSignerName] = useState(customerName);
  const [initialSignatureData, setInitialSignatureData] = useState<string | null>(null);

  // Series por item
  const [serials, setSerials] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, i.serial_number ?? ""])),
  );

  // Lightbox foto ampliada
  const [lightboxPhoto, setLightboxPhoto] = useState<InstallationPhoto | null>(null);

  // Modal confirmar periodicidad de mantenimientos (se abre antes de cerrar
  // la instalación si el contrato incluye mantenimiento — para que el
  // técnico confirme con el cliente cada cuánto vendrá la próxima visita
  // y ajustar si se ha pactado distinto en obra).
  const [mantPeriodicityOpen, setMantPeriodicityOpen] = useState(false);
  const [mantPeriodicity, setMantPeriodicity] = useState<number>(
    contractMaintenancePeriodicityMonths ?? 6,
  );
  const [mantMonthsIncluded, setMantMonthsIncluded] = useState<number>(
    contractMaintenanceMonthsIncluded ??
      contractDurationMonths ??
      12,
  );

  function reset() {
    setOpen(false);
    setStep(initialStatus === "scheduled" ? 1 : 2);
    setPauseOpen(false);
    setIncidentOpen(false);
  }

  // === GATING DE PASOS (obligatorios en orden) ===
  // 1. Parte iniciado (status=in_progress/paused/completed).
  // 2. Estado inicial guardado (toggles + firma si daño/agujero).
  // 3. Cobros: opcional — el comercial puede cobrar luego en oficina.
  // 4. Fotos: AL MENOS 1 de equipo + 1 de conexión.
  // 5. Firma del cliente + encuesta de satisfacción contestada.
  // 6. Cerrar: sólo accesible si 1..5 están OK; permite volver atrás.
  const initialStateSig = signatures.find(
    (s) => s.signer_role === "customer" && s.context === "initial_state",
  );
  const step1Done =
    status === "in_progress" || status === "paused" || status === "completed";
  const step2Done =
    !(hasPreviousDamage || needsCountertopDrilling) || Boolean(initialStateSig);
  // Cobros obligatorios: cada contract_payment debe estar gestionado.
  // Aceptamos:
  //   - status != "pending" (cobrado / validado / pago "ahora")
  //   - O moment === "on_installation" (diferido a este momento o
  //     marcado como "en oficina" — vía at_office reusa este moment).
  // En retiradas (uninstall) no hay cobros que gestionar — saltamos paso 3.
  const step3Done = isUninstall
    ? true
    : payments.every(
        (p) => p.status !== "pending" || p.moment === "on_installation",
      );
  // En retiradas exigimos al menos 1 foto (cómo queda el sitio tras
  // retirar el equipo). En instalaciones, 1 equipo + 1 conexión.
  const step4Done = isUninstall
    ? photos.length > 0
    : photos.some((p) => p.category === "equipment") &&
      photos.some((p) => p.category === "connection");
  // Paso 5 done si la firma final está guardada en BD (vía estado local
  // que se sincroniza al guardar). Al cargar el componente ya viene
  // marcada en true si la firma existía en `signatures` props.
  const step5Done = finalSignatureSaved;

  function canGoTo(target: Step): boolean {
    // Siempre puedes ir hacia atrás libremente.
    if (target <= step) return true;
    // Para avanzar, todos los pasos previos deben estar OK.
    if (target === 2) return step1Done;
    if (target === 3) return step1Done && step2Done;
    if (target === 4) return step1Done && step2Done && step3Done;
    if (target === 5)
      return step1Done && step2Done && step3Done && step4Done;
    if (target === 6)
      return step1Done && step2Done && step3Done && step4Done && step5Done;
    return false;
  }

  function tryGoTo(target: Step) {
    if (canGoTo(target)) {
      setStep(target);
      return;
    }
    const reasons: string[] = [];
    if (!step1Done) reasons.push("inicia el parte (paso 1)");
    if (!step2Done) reasons.push("firma el estado inicial (paso 2)");
    if (!step4Done && target >= 4) reasons.push("sube foto del equipo y de la conexión (paso 4)");
    if (!step5Done && target >= 5) reasons.push("firma cliente + encuesta (paso 5)");
    notify.warning(
      "Paso bloqueado",
      reasons.length ? `Antes: ${reasons.join("; ")}` : "Completa los pasos previos",
    );
  }

  // === HANDLERS ===

  function startParte() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify.warning("Geolocalización no disponible — se inicia sin geo");
      callStart(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => callStart(pos.coords.latitude, pos.coords.longitude),
      () => {
        notify.warning("Sin GPS — se inicia sin geo");
        callStart(null, null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
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
      startedAtRef.current = new Date().toISOString();
      // Feedback GPS detallado y siempre visible:
      //  - Sin GPS del técnico
      //  - Con GPS pero sin coordenadas del cliente para validar
      //  - Con GPS + coords cliente: distancia + estado válido/aviso
      if (lat == null || lng == null) {
        notify.success("Parte iniciado", "Sin GPS del dispositivo");
      } else if (r.meters == null) {
        notify.success(
          "Parte iniciado",
          "Cliente sin coordenadas — no se pudo validar la posición",
        );
      } else if (r.far) {
        notify.warning(
          `⚠ A ${r.meters} m del cliente (fuera de rango)`,
          "Aviso enviado a admin/director técnico",
        );
      } else {
        notify.success(
          `✓ Posición válida (${r.meters} m del cliente)`,
          "Parte iniciado",
        );
      }
      setStep(2);
    });
  }

  function saveInitialState() {
    startTransition(async () => {
      const r = await setInstallationInitialStateAction({
        installation_id: installationId,
        has_previous_damage: hasPreviousDamage,
        needs_countertop_drilling: needsCountertopDrilling,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      // Si marca daño/agujero, exigimos firma del cliente
      if (
        (hasPreviousDamage || needsCountertopDrilling) &&
        !signatures.find((s) => s.signer_role === "customer" && s.context === "initial_state")
      ) {
        if (!initialSignatureData) {
          notify.warning("Firma del cliente obligatoria al marcar daño o agujero");
          return;
        }
        if (!initialSignerName.trim()) {
          notify.warning("Indica el nombre del firmante");
          return;
        }
        const sr = await saveInstallationSignatureAction({
          installation_id: installationId,
          signer_role: "customer",
          signer_name: initialSignerName.trim(),
          signer_tax_id: null,
          signature_data_url: initialSignatureData,
          context: "initial_state",
        });
        if (!sr.ok) {
          notify.error("Error firma", sr.error);
          return;
        }
      }
      notify.success("Estado inicial guardado");
      setStep(3);
    });
  }

  function uploadPhoto(file: File, category: "equipment" | "connection" | "extra") {
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

  function saveSerials() {
    startTransition(async () => {
      for (const it of items) {
        const sn = (serials[it.id] ?? "").trim();
        if ((it.serial_number ?? "") !== sn) {
          const r = await setInstallationItemSerialAction(it.id, sn || null);
          if (!r.ok) {
            notify.error("No se pudo guardar nº serie", r.error);
            return;
          }
        }
      }
      notify.success("Números de serie guardados");
      setStep(5);
    });
  }

  /** Guarda la firma final en BD. Se llama al pasar de 5 → 6 para que
   *  no se pierda si el usuario vuelve atrás al paso 5. */
  function saveFinalSignature(onDone?: () => void) {
    if (!signerName.trim()) {
      notify.warning("Nombre del firmante obligatorio");
      return;
    }
    if (!signatureData) {
      notify.warning("Falta firma del cliente");
      return;
    }
    if (!isUninstall && !satisfaction) {
      notify.warning("El cliente debe marcar la encuesta de satisfacción");
      return;
    }
    setSavingSignature(true);
    startTransition(async () => {
      const r = await saveInstallationSignatureAction({
        installation_id: installationId,
        signer_role: "customer",
        signer_name: signerName.trim(),
        signer_tax_id: signerTaxId.trim() || null,
        signature_data_url: signatureData,
        context: "final",
      });
      setSavingSignature(false);
      if (!r.ok) {
        notify.error("No se pudo guardar firma", r.error);
        return;
      }
      setFinalSignatureSaved(true);
      notify.success("Firma guardada");
      if (onDone) onDone();
    });
  }

  /** Cierre real (después de confirmar la periodicidad si aplica). */
  function doFinish() {
    startTransition(async () => {
      const r = await finishInstallationAction({
        installation_id: installationId,
        satisfaction_score: satisfaction,
        satisfaction_comment: satisfactionComment || null,
        notes: finishNotes || null,
      });
      if (!r.ok) {
        notify.error("No se pudo cerrar", r.error);
        return;
      }
      notify.success("Instalación completada");
      reset();
      // Vuelta al listado tras cerrar (el técnico ya no tiene nada que
      // hacer en esta página). Mejor UX que quedarse en el detalle.
      router.push("/instalaciones");
    });
  }

  function finish() {
    if (!finalSignatureSaved) {
      notify.warning("Guarda la firma del cliente antes de cerrar");
      return;
    }
    if (!isUninstall && !satisfaction) {
      notify.warning("El cliente debe marcar la encuesta de satisfacción");
      return;
    }
    // Si el contrato incluye mantenimiento, antes de cerrar pedimos al
    // técnico que confirme la periodicidad y meses cubiertos con el
    // cliente. Lo que confirme se guarda en el contrato y se usa
    // para auto-agendar los jobs de mantenimiento.
    // No aplica en retiradas.
    if (!isUninstall && contractIncludesMaintenance) {
      setMantPeriodicityOpen(true);
      return;
    }
    doFinish();
  }

  function confirmMaintenanceAndFinish() {
    startTransition(async () => {
      const r = await updateContractMaintenanceScheduleAction({
        installation_id: installationId,
        periodicity_months: mantPeriodicity,
        months_included: mantMonthsIncluded,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar la periodicidad", r.error);
        return;
      }
      setMantPeriodicityOpen(false);
      doFinish();
    });
  }

  function confirmPause() {
    startTransition(async () => {
      const r = await pauseInstallationAction({
        installation_id: installationId,
        reason: pauseReason as "lunch" | "to_warehouse" | "to_buy" | "end_of_day" | "other",
        reason_notes: pauseNotes || undefined,
        scheduled_resume_at:
          pauseReason === "end_of_day" && pauseScheduledAt
            ? pauseScheduledAt
            : null,
      });
      if (!r.ok) {
        notify.error("No se pudo pausar", r.error);
        return;
      }
      notify.success("Pausa registrada");
      setStatus("paused");
      setPauseOpen(false);
      setPauseReason("lunch");
      setPauseNotes("");
      setPauseScheduledAt("");
    });
  }

  function doResume() {
    startTransition(async () => {
      const r = await resumeInstallationAction(installationId);
      if (!r.ok) {
        notify.error("No se pudo reanudar", r.error);
        return;
      }
      notify.success("Reanudado");
      setStatus("in_progress");
      startedAtRef.current = new Date().toISOString();
    });
  }

  function confirmIncident() {
    if (!incidentKind) return;
    startTransition(async () => {
      const r = await reportInstallationIncidentAction({
        installation_id: installationId,
        kind: incidentKind as "stock_shortage" | "missing_material" | "wrong_equipment" | "broken_equipment" | "customer_issue" | "other",
        description: incidentDesc || undefined,
        pause_and_unschedule: incidentUnschedule,
      });
      if (!r.ok) {
        notify.error("No se pudo registrar incidencia", r.error);
        return;
      }
      notify.success(
        incidentUnschedule
          ? "Incidencia abierta. Instalación pendiente de reagendar"
          : "Incidencia notificada a admin/dir. técnico",
      );
      setIncidentOpen(false);
      setIncidentKind("stock_shortage");
      setIncidentDesc("");
      setIncidentUnschedule(false);
      if (incidentUnschedule) {
        setStatus("incident_pending");
        reset();
        router.refresh();
      }
    });
  }

  // Bloqueador: si el contrato no está firmado, el instalador NO puede
  // abrir el parte. Tiene que pasar el iPad al cliente para que firme
  // primero (decisión usuario 2026-05-08).
  const contractNotSigned =
    contractStatus &&
    !["signed", "active", "validated"].includes(contractStatus);

  return (
    <>
      {contractNotSigned ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">⚠ Contrato sin firmar</p>
          <p className="mt-1 text-sm text-amber-800">
            El cliente debe firmar el contrato antes de empezar la instalación.
            Abre el contrato y pásale el dispositivo para que firme.
          </p>
          <a
            href={`/contratos/${contractId}`}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700"
          >
            → Abrir contrato para firmar
          </a>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} variant="success" className="gap-2">
          <Sparkles className="h-4 w-4" />
          {isUninstall ? "Abrir parte de retirada" : "Abrir parte de instalación"}
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex h-full w-full flex-col bg-card">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">
                  {isUninstall ? "Parte de retirada" : "Parte de instalación"}
                </h2>
                <p className="truncate text-xs text-muted-foreground">{customerName}</p>
              </div>
              <div className="flex items-center gap-2">
                {status === "in_progress" && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span className="tabular-nums">{formatDuration(elapsed)}</span>
                  </span>
                )}
                {status === "paused" && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border-2 border-amber-500 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
                    <Pause className="h-3.5 w-3.5" /> En pausa
                  </span>
                )}
                {status === "in_progress" && (
                  <Button size="sm" variant="outline" onClick={() => setPauseOpen(true)}>
                    <Pause className="h-3 w-3" /> Pausa
                  </Button>
                )}
                {status === "paused" && (
                  <Button size="sm" variant="success" onClick={doResume} disabled={pending}>
                    <Play className="h-3 w-3" /> Reanudar
                  </Button>
                )}
                {status !== "completed" && (
                  <Button
                    size="sm"
                    variant="warning"
                    onClick={() => setIncidentOpen(true)}
                  >
                    <AlertTriangle className="h-3 w-3" /> Incidencia
                  </Button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-full p-2 hover:bg-muted"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Stepper */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto border-b bg-muted/30 px-3 py-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const active = step === s.n;
                const isComplete =
                  (s.n === 1 && step1Done) ||
                  (s.n === 2 && step2Done) ||
                  (s.n === 3 && step3Done) ||
                  (s.n === 4 && step4Done) ||
                  (s.n === 5 && step5Done);
                const reachable = canGoTo(s.n);
                return (
                  <div key={s.n} className="flex flex-1 min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => tryGoTo(s.n)}
                      disabled={!reachable}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-bold transition ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : isComplete
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : reachable
                              ? "border-border bg-card text-muted-foreground"
                              : "border-border bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden sm:inline">{s.n}. {s.label}</span>
                      <span className="sm:hidden">{s.n}</span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className="hidden h-0.5 w-2 bg-border md:block" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* PASO 1 — Iniciar parte */}
              {step === 1 && (
                <div className="space-y-4">
                  {/* Manuales del equipo + avisos del admin. Visible siempre;
                      modal automático con notas si el parte ya está iniciado. */}
                  <InstallationAidsPanel
                    installationId={installationId}
                    showOnMount={status === "in_progress"}
                  />
                  {/* Card destacada con datos del cliente (decisión usuario 2026-05-11):
                      al abrir el parte el técnico ve quién es el cliente sin tener
                      que volver a la ficha. */}
                  <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-primary">
                      Cliente
                    </div>
                    <div className="text-lg font-extrabold text-foreground">
                      {customerName}
                      {customerTaxId && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          · {customerTaxId}
                        </span>
                      )}
                    </div>
                    {installationAddress && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="font-bold text-muted-foreground">Dirección:</span>
                        <span>{installationAddress}</span>
                      </div>
                    )}
                    {(customerPhone || customerEmail) && (
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
                        {customerPhone && (
                          <a
                            href={`tel:${customerPhone}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          >
                            📞 Llamar {customerPhone}
                          </a>
                        )}
                        {customerEmail && (
                          <span className="text-xs text-muted-foreground">
                            {customerEmail}
                          </span>
                        )}
                      </div>
                    )}
                    {scheduledAt && (
                      <div className="pt-2 text-xs text-muted-foreground">
                        Programada para:{" "}
                        <strong>
                          {new Date(scheduledAt).toLocaleString("es-ES", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </strong>
                      </div>
                    )}
                  </div>

                  {/* Bloqueo por incidencia abierta (decisión 2026-05-19):
                      si hay una incidencia abierta (típico: stock insuficiente)
                      NO se puede iniciar parte hasta resolverla. */}
                  {hasOpenIncident && status !== "in_progress" && status !== "paused" && (
                    <div className="rounded-xl border-2 border-rose-400 bg-rose-50 p-3 text-sm text-rose-900">
                      <p className="font-bold">⛔ Incidencia abierta sin resolver</p>
                      <p className="mt-1 text-xs">
                        No puedes iniciar este parte hasta que la incidencia
                        esté resuelta. Cierra la incidencia desde el bloque
                        superior (admin / director técnico) y vuelve a abrir
                        el parte.
                      </p>
                    </div>
                  )}

                  {/* Ventana 24h (decisión usuario 2026-05-19):
                      solo se puede iniciar dentro de las 24h previas y las
                      24h posteriores al scheduled_at. Antes hay que pedir
                      al director que adelante la fecha. */}
                  {(() => {
                    if (!scheduledAt || status === "in_progress" || status === "paused") return null;
                    const now = Date.now();
                    const sched = new Date(scheduledAt).getTime();
                    const HOUR = 3600 * 1000;
                    if (sched > now + 24 * HOUR) {
                      const hoursLeft = Math.round((sched - now) / HOUR);
                      return (
                        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          <p className="font-bold">⚠ Aún faltan más de 24h</p>
                          <p className="mt-1 text-xs">
                            La instalación está programada para{" "}
                            <strong>{new Date(scheduledAt).toLocaleString("es-ES")}</strong>
                            {" "}(faltan ~{hoursLeft}h). Solo se puede iniciar el
                            parte dentro de las 24 horas previas. Si necesitas
                            adelantarla, pide al director (nivel 2) que cambie
                            la fecha.
                          </p>
                        </div>
                      );
                    }
                    if (sched < now - 24 * HOUR) {
                      return (
                        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                          <p className="font-bold">⚠ Fecha pasada hace más de 24h</p>
                          <p className="mt-1 text-xs">
                            La instalación estaba programada para{" "}
                            <strong>{new Date(scheduledAt).toLocaleString("es-ES")}</strong>
                            . Habla con un director para reprogramarla antes
                            de iniciarla.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <p className="text-sm">
                    Pulsa <strong>Iniciar parte</strong> y se capturará tu posición GPS
                    automáticamente.
                  </p>
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <strong>Restricción 300 m:</strong> Si estás a más de 300 m del cliente
                    NO se bloquea, pero se enviará un aviso a admin y director técnico.
                  </div>
                  {status === "in_progress" ? (
                    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                      ✓ Parte ya iniciado. Continúa al paso 2.
                    </div>
                  ) : (() => {
                    // Bloquear si:
                    //  · Hay incidencia abierta sin resolver
                    //  · NO está agendado (scheduledAt null)
                    //  · O el scheduled_at está fuera de la ventana ±24h
                    let blocked = false;
                    let blockedMsg = "Iniciar parte (capturar GPS)";
                    if (hasOpenIncident) {
                      blocked = true;
                      blockedMsg = "Bloqueado — incidencia abierta";
                    } else if (!scheduledAt) {
                      blocked = true;
                      blockedMsg = "Agenda primero la instalación";
                    } else {
                      const now = Date.now();
                      const sched = new Date(scheduledAt).getTime();
                      const HOUR = 3600 * 1000;
                      if (sched > now + 24 * HOUR) {
                        blocked = true;
                        blockedMsg = "Aún faltan más de 24h";
                      } else if (sched < now - 24 * HOUR) {
                        blocked = true;
                        blockedMsg = "Fecha pasada — reprogramar";
                      }
                    }
                    return (
                      <Button
                        onClick={startParte}
                        disabled={pending || blocked}
                        className="w-full"
                        variant="success"
                        size="lg"
                      >
                        <Crosshair className="h-4 w-4" />
                        {blockedMsg}
                      </Button>
                    );
                  })()}
                </div>
              )}

              {/* PASO 2 — Estado inicial */}
              {step === 2 && status === "scheduled" && (
                <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-bold">⚠ Inicia primero el parte</p>
                  <p className="text-xs">
                    El estado inicial (desperfectos previos, necesidad de
                    agujerear encimera…) solo se rellena cuando estás en el
                    lugar. Vuelve al paso 1 y pulsa &laquo;Iniciar parte&raquo;.
                  </p>
                </div>
              )}
              {step === 2 && status !== "scheduled" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Marca el estado del lugar antes de empezar a instalar.
                  </p>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border p-3 hover:border-amber-400">
                    <input
                      type="checkbox"
                      checked={hasPreviousDamage}
                      onChange={(e) => setHasPreviousDamage(e.target.checked)}
                      className="mt-0.5 h-5 w-5"
                    />
                    <div>
                      <div className="font-bold">Hay desperfectos previos</div>
                      <div className="text-xs text-muted-foreground">
                        Marca esto si la cocina/lugar ya tenía algún daño antes de tu llegada.
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border p-3 hover:border-amber-400">
                    <input
                      type="checkbox"
                      checked={needsCountertopDrilling}
                      onChange={(e) => setNeedsCountertopDrilling(e.target.checked)}
                      className="mt-0.5 h-5 w-5"
                    />
                    <div>
                      <div className="font-bold">Hay que agujerear la encimera</div>
                      <div className="text-xs text-muted-foreground">
                        Necesario para pasar la mecha del grifo.
                      </div>
                    </div>
                  </label>

                  {(hasPreviousDamage || needsCountertopDrilling) && (
                    <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-900">
                        ⚠ El cliente debe firmar el conocimiento de este estado inicial
                      </p>
                      <Input
                        value={initialSignerName}
                        onChange={(e) => setInitialSignerName(e.target.value)}
                        placeholder="Nombre del firmante (puede ser un familiar)"
                      />
                      <SignaturePad onChange={setInitialSignatureData} />
                    </div>
                  )}

                  <Button onClick={saveInitialState} disabled={pending} className="w-full">
                    Guardar y continuar <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* PASO 3 — Cobros */}
              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    <strong>Obligatorio:</strong> marca cómo se cobra cada línea
                    (ahora, en oficina o en la instalación). No se permite
                    avanzar mientras quede algún cobro sin gestionar.
                  </p>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin cobros pendientes.</p>
                  ) : (
                    <div className="space-y-2">
                      {payments.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-xl border-2 border-border bg-card p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-bold">{p.concept}</div>
                              <div className="text-xs text-muted-foreground">
                                {(p.amount_cents / 100).toFixed(2)} €
                              </div>
                            </div>
                            <Badge variant={p.status === "validated" ? "success" : "secondary"}>
                              {p.status === "pending" ? "Pendiente" : "Cobrado"}
                            </Badge>
                          </div>
                          <div className="mt-3">
                            <CollectInline
                              paymentId={p.id}
                              status={p.status}
                              defaultMethod={p.method}
                              amountLabel={`${(p.amount_cents / 100).toFixed(2)} €`}
                              canEditAfterCollect={canEditCollectedPayments}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PASO 4 — Equipos y fotos */}
              {step === 4 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Foto de cada equipo, foto de la conexión y nº de serie opcional.
                  </p>
                  {!step4Done && (
                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <strong>⚠ Fotos obligatorias:</strong>{" "}
                      {!photos.some((p) => p.category === "equipment") &&
                        !photos.some((p) => p.category === "connection")
                        ? "falta 1 foto de equipo y 1 de conexión."
                        : !photos.some((p) => p.category === "equipment")
                          ? "falta al menos 1 foto del equipo."
                          : "falta al menos 1 foto de la conexión."}
                    </div>
                  )}
                  {step4Done && (
                    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
                      ✓ Fotos mínimas subidas (equipo + conexión).
                    </div>
                  )}

                  {/* Items con S/N */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {status === "completed" ? "Equipos instalados" : "Equipos a instalar"}
                    </p>
                    {items.map((it) => (
                      <div
                        key={it.id}
                        className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_180px]"
                      >
                        <div>
                          <div className="font-bold">{it.product_name}</div>
                          <div className="text-xs text-muted-foreground">
                            Cantidad: {it.quantity}
                          </div>
                        </div>
                        <Input
                          placeholder="Nº serie (opcional)"
                          value={serials[it.id] ?? ""}
                          onChange={(e) =>
                            setSerials((cur) => ({ ...cur, [it.id]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>

                  {/* Subida de fotos */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Fotos
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <PhotoButton
                        label="Equipo"
                        category="equipment"
                        onPick={uploadPhoto}
                      />
                      <PhotoButton
                        label="Conexión"
                        category="connection"
                        onPick={uploadPhoto}
                      />
                      <PhotoButton label="Otra +" category="extra" onPick={uploadPhoto} />
                    </div>
                    {photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {photos.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => p.signed_url && setLightboxPhoto(p)}
                            className="relative aspect-square overflow-hidden rounded-lg border transition hover:ring-2 hover:ring-primary"
                            aria-label="Ampliar foto"
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
                                : p.category === "connection"
                                  ? "Conexión"
                                  : p.category === "damage"
                                    ? "Daño"
                                    : "Otra"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={saveSerials}
                    disabled={pending || !step4Done}
                    className="w-full"
                  >
                    Guardar y continuar <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* PASO 5 — Firma final + encuesta */}
              {step === 5 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Una vez terminada la instalación: firma del cliente y encuesta de
                    satisfacción.
                  </p>

                  <div className="space-y-3 rounded-xl border-2 border-border p-4">
                    <h3 className="font-bold">Firma del cliente</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Nombre</Label>
                        <Input
                          value={signerName}
                          onChange={(e) => setSignerName(e.target.value)}
                          disabled={finalSignatureSaved}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>DNI / NIE</Label>
                        <Input
                          value={signerTaxId}
                          onChange={(e) => setSignerTaxId(e.target.value.toUpperCase())}
                          disabled={finalSignatureSaved}
                        />
                      </div>
                    </div>
                    {finalSignatureSaved ? (
                      <div className="space-y-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
                        <p className="text-sm font-bold text-emerald-900">
                          ✓ Firma guardada
                        </p>
                        <p className="text-xs text-emerald-800">
                          La firma del cliente ya está registrada. Si necesitas
                          rehacerla, pulsa abajo.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFinalSignatureSaved(false);
                            setSignatureData(null);
                          }}
                        >
                          Re-firmar
                        </Button>
                      </div>
                    ) : (
                      <>
                        <SignaturePad onChange={setSignatureData} />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => saveFinalSignature()}
                          disabled={savingSignature || !signatureData || !signerName.trim()}
                          className="w-full"
                        >
                          {savingSignature ? "Guardando…" : "Guardar firma"}
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="space-y-2 rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
                    <h3 className="flex items-center gap-2 font-bold text-blue-900">
                      <Smile className="h-4 w-4" /> ¿Cómo de satisfecho estás con la instalación?
                    </h3>
                    <p className="text-xs text-blue-800">
                      Encuesta anónima — el instalador NO ve tu respuesta.
                    </p>
                    {satisfaction == null ? (
                      <div className="grid grid-cols-5 gap-2">
                        {FACES.map((f) => (
                          <button
                            key={f.v}
                            type="button"
                            onClick={() => setSatisfaction(f.v)}
                            className="flex flex-col items-center gap-1 rounded-xl border-2 border-border bg-card p-2 hover:border-primary/40"
                          >
                            <span className="text-3xl">{f.emoji}</span>
                            <span className="text-[10px] font-bold">{f.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-center">
                        <p className="text-sm font-bold text-emerald-900">
                          ✓ Gracias por tu valoración
                        </p>
                        <p className="text-xs text-emerald-800">
                          Respuesta guardada de forma anónima.
                        </p>
                      </div>
                    )}
                    {satisfaction != null && (
                      <Input
                        placeholder="Comentario opcional (también anónimo)"
                        value={satisfactionComment}
                        onChange={(e) => setSatisfactionComment(e.target.value)}
                      />
                    )}
                  </div>

                  <Button
                    onClick={() => {
                      // Si la firma aún no está guardada server-side la
                      // guardamos antes de avanzar — así si vuelve atrás
                      // al paso 5 sigue presente.
                      if (finalSignatureSaved) {
                        setStep(6);
                        return;
                      }
                      saveFinalSignature(() => setStep(6));
                    }}
                    disabled={
                      pending ||
                      savingSignature ||
                      (!finalSignatureSaved && !signatureData) ||
                      !satisfaction
                    }
                    className="w-full"
                  >
                    {finalSignatureSaved
                      ? "Continuar"
                      : savingSignature
                        ? "Guardando firma…"
                        : "Guardar firma y continuar"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* PASO 6 — Cerrar */}
              {step === 6 && (
                <div className="space-y-4">
                  <h3 className="font-bold">Resumen y cierre</h3>
                  <div className="grid gap-2 text-sm">
                    <div>
                      Tiempo trabajado: <strong>{formatDuration(elapsed)}</strong>
                    </div>
                    <div>
                      Cliente: <strong>{customerName}</strong>
                    </div>
                    <div>
                      Encuesta:{" "}
                      <strong>
                        {satisfaction
                          ? FACES.find((f) => f.v === satisfaction)?.emoji
                          : "—"}
                      </strong>
                    </div>
                  </div>
                  <div>
                    <Label>Notas finales (opcional)</Label>
                    <textarea
                      rows={3}
                      value={finishNotes}
                      onChange={(e) => setFinishNotes(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-input bg-background p-2 text-sm"
                      placeholder="Observaciones generales del trabajo realizado…"
                    />
                  </div>
                  {/* Mantenimiento: si el contrato principal NO incluye, se
                      ofrece crear un contrato de mantenimiento independiente.
                      Regla 2026-05-11: NO ofrecer si el contrato es
                      'rental' (alquiler) activo — el alquiler incluye
                      mantenimiento implícito porque el equipo es de la
                      empresa y ésta se responsabiliza de su funcionamiento.
                      Solo se ofrece para:
                        - cash (compra al contado, sin mantenimiento)
                        - renting una vez completed (terminado)
                        - sin contrato (equipo externo / otra empresa) */}
                  {(() => {
                    const isRentalActive =
                      contractPlanType === "rental" &&
                      contractStatus !== "completed" &&
                      contractStatus !== "cancelled";
                    const shouldOffer =
                      !contractIncludesMaintenance &&
                      !isRentalActive &&
                      customerId &&
                      maintenancePlans.length > 0;
                    if (!shouldOffer) return null;
                    return (
                      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                        <p className="text-sm font-bold text-amber-900">
                          ¿Quieres ofrecerle un contrato de mantenimiento al cliente?
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          Tu contrato principal no incluye mantenimiento. Puedes
                          generar ahora uno (Lite / Medium / Premium) con remesa
                          mensual.
                        </p>
                        <div className="mt-2">
                          <MaintenancePlanPicker
                            customerId={customerId}
                            plans={maintenancePlans}
                            sourceInstallationId={installationId}
                            sourceContractId={contractId}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  <Button
                    onClick={finish}
                    disabled={pending}
                    variant="success"
                    size="lg"
                    className="w-full"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {pending ? "Cerrando…" : "Completar instalación"}
                  </Button>
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
                disabled={step === 1}
              >
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
              <span className="text-xs text-muted-foreground">Paso {step} de 6</span>
              {step < 6 ? (
                <Button
                  size="sm"
                  onClick={() => tryGoTo(((step + 1) as Step))}
                  disabled={!canGoTo((step + 1) as Step)}
                >
                  Siguiente <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          </div>

          {/* Modal pausa */}
          {pauseOpen && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4"
              onClick={() => setPauseOpen(false)}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 border-b p-3 font-bold">Pausa</div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  <Label>Motivo</Label>
                  <select
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value)}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                  >
                    {PAUSE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="Notas (opcional)"
                    value={pauseNotes}
                    onChange={(e) => setPauseNotes(e.target.value)}
                  />
                  {pauseReason === "end_of_day" && (
                    <div className="space-y-1">
                      <Label>Hora prevista de retomar</Label>
                      <Input
                        type="datetime-local"
                        value={pauseScheduledAt}
                        onChange={(e) => setPauseScheduledAt(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t p-3">
                  <Button variant="outline" onClick={() => setPauseOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={confirmPause} disabled={pending} variant="warning">
                    Pausar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Modal incidencia */}
          {incidentOpen && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4"
              onClick={() => setIncidentOpen(false)}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 border-b p-3 font-bold">Notificar incidencia</div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  <Label>Tipo</Label>
                  <select
                    value={incidentKind}
                    onChange={(e) => setIncidentKind(e.target.value)}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                  >
                    {INCIDENT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <Label>Descripción</Label>
                  <textarea
                    rows={3}
                    value={incidentDesc}
                    onChange={(e) => setIncidentDesc(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                    placeholder="Detalla qué ha pasado…"
                  />
                  <label className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={incidentUnschedule}
                      onChange={(e) => setIncidentUnschedule(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="text-sm">
                      <strong className="text-amber-900">Parar la instalación y dejarla pendiente de reagendar.</strong>
                      <br />
                      <span className="text-amber-800 text-xs">
                        La incidencia se abre en el módulo de incidencias y la
                        instalación vuelve a la lista «Sin agendar» de la agenda.
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t p-3">
                  <Button variant="outline" onClick={() => setIncidentOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={confirmIncident} disabled={pending} variant="warning">
                    Notificar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Modal confirmar periodicidad de mantenimientos */}
          {mantPeriodicityOpen && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4"
              onClick={() => setMantPeriodicityOpen(false)}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 border-b p-3 font-bold">
                  Confirmar mantenimientos
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  <p className="text-sm text-muted-foreground">
                    Confirma con el cliente cada cuánto vendrá la próxima
                    revisión y durante cuántos meses está cubierto. Al cerrar
                    la instalación se programará el siguiente mantenimiento
                    automáticamente.
                  </p>
                  <div className="space-y-1">
                    <Label>Periodicidad (meses entre revisiones)</Label>
                    <select
                      value={mantPeriodicity}
                      onChange={(e) =>
                        setMantPeriodicity(Number(e.target.value))
                      }
                      className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                    >
                      {[3, 4, 6, 8, 12, 18, 24].map((m) => (
                        <option key={m} value={m}>
                          Cada {m} {m === 1 ? "mes" : "meses"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Meses cubiertos en total</Label>
                    <Input
                      type="number"
                      min={mantPeriodicity}
                      max={240}
                      value={mantMonthsIncluded}
                      onChange={(e) =>
                        setMantMonthsIncluded(
                          Math.max(
                            mantPeriodicity,
                            parseInt(e.target.value || "0", 10) || 0,
                          ),
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Se generarán{" "}
                      <strong>
                        {Math.floor(mantMonthsIncluded / mantPeriodicity)}
                      </strong>{" "}
                      mantenimientos programados.
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    El primer mantenimiento se agendará dentro de{" "}
                    <strong>{mantPeriodicity} meses</strong> desde hoy. El
                    cliente recibirá un aviso unos días antes de cada visita.
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t p-3">
                  <Button
                    variant="outline"
                    onClick={() => setMantPeriodicityOpen(false)}
                    disabled={pending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={confirmMaintenanceAndFinish}
                    disabled={pending}
                    variant="success"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {pending ? "Cerrando…" : "Confirmar y cerrar"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* === Lightbox foto ampliada === */}
          {lightboxPhoto && lightboxPhoto.signed_url && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
              onClick={() => setLightboxPhoto(null)}
              role="dialog"
              aria-label="Foto ampliada"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxPhoto(null);
                }}
                className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black hover:bg-white"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="absolute left-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-bold text-black">
                {lightboxPhoto.category === "equipment"
                  ? "Equipo"
                  : lightboxPhoto.category === "connection"
                    ? "Conexión"
                    : lightboxPhoto.category === "damage"
                      ? "Daño"
                      : "Otra"}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxPhoto.signed_url}
                alt={lightboxPhoto.category}
                className="max-h-full max-w-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// === SignaturePad inline ===
function SignaturePad({ onChange }: { onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
  }, []);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = ref.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(ref.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
  }
  return (
    <div className="space-y-1.5">
      <canvas
        ref={ref}
        className="h-32 w-full touch-none rounded-xl border-2 border-dashed border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          <Trash2 className="h-3 w-3" /> Limpiar
        </Button>
      </div>
    </div>
  );
}

function PhotoButton({
  label,
  category,
  onPick,
}: {
  label: string;
  category: "equipment" | "connection" | "extra";
  onPick: (file: File, category: "equipment" | "connection" | "extra") => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border bg-card p-3 hover:border-primary"
      >
        <Camera className="h-5 w-5 text-primary" />
        <span className="text-xs font-bold">{label}</span>
      </button>
      <input
        ref={fileRef}
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
