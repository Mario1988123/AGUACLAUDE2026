"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, User, Eraser, CheckCircle2, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveContractSignatureAction, type ContractSignature } from "./signatures-actions";

type Role = "representative" | "customer";

function SignatureCanvas({
  onChange,
}: {
  onChange: (v: string | null) => void;
}) {
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
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const c = ref.current!;
    onChange(c.toDataURL("image/png"));
  }
  function clear() {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          <Eraser className="h-3 w-3" /> Limpiar
        </Button>
      </div>
    </div>
  );
}

function SignedView({ dataUrl }: { dataUrl: string | null }) {
  if (!dataUrl) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border-2 border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
        Firma guardada (sin imagen disponible)
      </div>
    );
  }
  return (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="Firma"
        className="mx-auto h-36 object-contain"
      />
    </div>
  );
}

function SignatureBlock({
  role,
  title,
  icon: Icon,
  signature,
  defaultName,
  defaultTaxId,
  showTaxId,
  contractId,
  onSaved,
}: {
  role: Role;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  signature: ContractSignature | undefined;
  defaultName: string;
  defaultTaxId?: string | null;
  showTaxId: boolean;
  contractId: string;
  onSaved: () => void;
}) {
  // Si ya está firmada, arrancamos en modo "ver". El usuario puede pulsar
  // "Re-firmar" para volver a abrir el canvas.
  const [editing, setEditing] = useState(!signature);
  const [name, setName] = useState(signature?.signer_name ?? defaultName);
  const [taxId, setTaxId] = useState(signature?.signer_tax_id ?? defaultTaxId ?? "");
  const [data, setData] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!name.trim()) {
      notify.warning("Falta el nombre del firmante");
      return;
    }
    if (!data) {
      notify.warning("Falta la firma — dibújala antes de validar");
      return;
    }
    if (showTaxId && !taxId.trim()) {
      notify.warning("Falta el DNI/CIF del cliente");
      return;
    }
    startTransition(async () => {
      try {
        await saveContractSignatureAction({
          contract_id: contractId,
          signer_role: role,
          signer_name: name.trim(),
          signer_tax_id: showTaxId ? taxId.trim() : null,
          signature_data_url: data,
        });
        notify.success(role === "representative" ? "Firma de empresa validada" : "Firma del cliente validada");
        setEditing(false);
        onSaved();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div
      className={`rounded-2xl border-2 p-4 ${
        signature && !editing
          ? "border-emerald-300 bg-emerald-50/40"
          : "border-border bg-card"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="font-bold">{title}</h3>
        {signature && !editing && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Validada
          </span>
        )}
      </div>

      {/* Vista bloqueada (firma ya validada) */}
      {signature && !editing && (
        <div className="space-y-2">
          <div className="text-sm">
            <strong>{signature.signer_name}</strong>
            {signature.signer_tax_id && ` · ${signature.signer_tax_id}`}
          </div>
          <SignedView dataUrl={signature.signature_data_url} />
          <p className="text-xs text-muted-foreground">
            Firmado el {new Date(signature.signed_at).toLocaleString("es-ES")}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="w-full">
            <Pencil className="h-3 w-3" /> Re-firmar
          </Button>
        </div>
      )}

      {/* Modo edición (canvas activo) */}
      {editing && (
        <div className="space-y-3">
          {showTaxId ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>DNI / CIF</Label>
                <Input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value.toUpperCase())}
                  placeholder="00000000A"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Representante</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <SignatureCanvas onChange={setData} />
          <div className="flex gap-2">
            {signature && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="flex-1"
              >
                Cancelar
              </Button>
            )}
            <Button onClick={save} disabled={pending} className="flex-1">
              <CheckCircle2 className="h-3 w-3" />
              {pending ? "Validando…" : "Validar firma"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SignaturesCard({
  contractId,
  signatures,
  defaultRepresentativeName,
  defaultCustomerName,
  defaultCustomerTaxId,
}: {
  contractId: string;
  signatures: ContractSignature[];
  defaultRepresentativeName?: string;
  defaultCustomerName?: string;
  defaultCustomerTaxId?: string | null;
}) {
  const router = useRouter();
  const repSig = signatures.find((s) => s.signer_role === "representative");
  const custSig = signatures.find((s) => s.signer_role === "customer");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SignatureBlock
        role="representative"
        title="La Empresa"
        icon={Building2}
        signature={repSig}
        defaultName={defaultRepresentativeName ?? ""}
        showTaxId={false}
        contractId={contractId}
        onSaved={() => router.refresh()}
      />
      <SignatureBlock
        role="customer"
        title="El Cliente"
        icon={User}
        signature={custSig}
        defaultName={defaultCustomerName ?? ""}
        defaultTaxId={defaultCustomerTaxId}
        showTaxId
        contractId={contractId}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
