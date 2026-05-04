"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, User, Eraser, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveContractSignatureAction, type ContractSignature } from "./signatures-actions";

type Role = "representative" | "customer";

function SignatureCanvas({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Reset canvas size to match displayed size
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
    if (value) {
      const img = new window.Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
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
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={disabled}>
          <Eraser className="h-3 w-3" /> Limpiar
        </Button>
      </div>
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
  const [pending, startTransition] = useTransition();

  const repSig = signatures.find((s) => s.signer_role === "representative");
  const custSig = signatures.find((s) => s.signer_role === "customer");

  const [repName, setRepName] = useState(repSig?.signer_name ?? defaultRepresentativeName ?? "");
  const [repData, setRepData] = useState<string | null>(repSig?.signature_data_url ?? null);

  const [custName, setCustName] = useState(custSig?.signer_name ?? defaultCustomerName ?? "");
  const [custTaxId, setCustTaxId] = useState(
    custSig?.signer_tax_id ?? defaultCustomerTaxId ?? "",
  );
  const [custData, setCustData] = useState<string | null>(custSig?.signature_data_url ?? null);

  function save(role: Role) {
    const name = role === "representative" ? repName : custName;
    const data = role === "representative" ? repData : custData;
    const taxId = role === "representative" ? null : custTaxId;
    if (!name.trim()) {
      notify.warning("Falta el nombre del firmante");
      return;
    }
    if (!data) {
      notify.warning("Falta la firma — dibújala antes de guardar");
      return;
    }
    if (role === "customer" && !taxId?.trim()) {
      notify.warning("Falta el DNI/CIF del cliente");
      return;
    }
    startTransition(async () => {
      try {
        await saveContractSignatureAction({
          contract_id: contractId,
          signer_role: role,
          signer_name: name.trim(),
          signer_tax_id: taxId?.trim() || null,
          signature_data_url: data,
        });
        notify.success(role === "representative" ? "Firma de empresa guardada" : "Firma del cliente guardada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* LA EMPRESA */}
      <div className="rounded-2xl border-2 border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-bold">La Empresa</h3>
          {repSig && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Firmado
            </span>
          )}
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Representante</Label>
            <Input
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              placeholder="Nombre y apellidos"
            />
          </div>
          <SignatureCanvas value={repData} onChange={setRepData} disabled={Boolean(repSig)} />
          {!repSig && (
            <Button onClick={() => save("representative")} disabled={pending} className="w-full">
              Guardar firma empresa
            </Button>
          )}
          {repSig && (
            <p className="text-xs text-muted-foreground">
              Firmado el {new Date(repSig.signed_at).toLocaleString("es-ES")}
            </p>
          )}
        </div>
      </div>

      {/* EL CLIENTE */}
      <div className="rounded-2xl border-2 border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          <h3 className="font-bold">El Cliente</h3>
          {custSig && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Firmado
            </span>
          )}
        </div>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                placeholder="Nombre y apellidos"
              />
            </div>
            <div className="space-y-1">
              <Label>DNI / CIF</Label>
              <Input
                value={custTaxId}
                onChange={(e) => setCustTaxId(e.target.value.toUpperCase())}
                placeholder="00000000A"
              />
            </div>
          </div>
          <SignatureCanvas value={custData} onChange={setCustData} disabled={Boolean(custSig)} />
          {!custSig && (
            <Button onClick={() => save("customer")} disabled={pending} className="w-full">
              Guardar firma cliente
            </Button>
          )}
          {custSig && (
            <p className="text-xs text-muted-foreground">
              Firmado el {new Date(custSig.signed_at).toLocaleString("es-ES")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
