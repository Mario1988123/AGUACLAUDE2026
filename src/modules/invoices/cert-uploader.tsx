"use client";

import { useState, useTransition } from "react";
import { Upload, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  uploadCertificateAction,
  deleteCertificateAction,
} from "./cert-actions";

export function CertUploader({
  certAlias,
  certExpiresAt,
}: {
  certAlias: string | null;
  certExpiresAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password.trim()) {
      notify.warning("Introduce el password del certificado");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("password", password);
    startTransition(async () => {
      try {
        const r = await uploadCertificateAction(fd);
        notify.success(
          "Certificado subido",
          `Caduca ${new Date(r.info.valid_to).toLocaleDateString("es-ES")} (${r.info.expires_in_days} días)`,
        );
        setPassword("");
        setOpen(false);
        location.reload();
      } catch (err) {
        notify.error(
          "No se pudo subir",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  async function handleDelete() {
    const ok = await ask({
      message:
        "¿Eliminar el certificado? Tendrás que volver a subirlo y mientras no podrás enviar facturas a la AEAT en modo Verifactu.",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteCertificateAction();
        notify.success("Certificado eliminado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Estado actual
  const expiresInDays = certExpiresAt
    ? Math.floor(
        (new Date(certExpiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const expiringSoon = expiresInDays !== null && expiresInDays < 30;

  if (certAlias && !open) {
    return (
      <div className="space-y-3">
        <div
          className={`rounded-xl border-2 p-3 ${
            expiringSoon
              ? "border-amber-300 bg-amber-50"
              : "border-emerald-300 bg-emerald-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                expiringSoon ? "text-amber-600" : "text-emerald-600"
              }`}
            />
            <div className="flex-1">
              <div className="text-sm font-bold">
                Certificado FNMT instalado
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {certAlias}
              </div>
              {certExpiresAt && (
                <div
                  className={`mt-1 text-xs ${
                    expiringSoon ? "font-bold text-amber-800" : "text-muted-foreground"
                  }`}
                >
                  Caduca {new Date(certExpiresAt).toLocaleDateString("es-ES")}
                  {expiresInDays !== null && (
                    <> · {expiresInDays} días</>
                  )}
                  {expiringSoon && " ⚠ renuévalo pronto en sede FNMT"}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={pending}
          >
            <Upload className="h-4 w-4" /> Sustituir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Eliminar
          </Button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Sin certificado.</strong> Para enviar facturas a la AEAT
              en modo Verifactu necesitas subir el certificado digital de tu
              empresa (.p12 o .pfx). Lo guardamos cifrado AES-256-GCM en BD.
              Solo se descifra dentro del cron de envío AEAT.
            </div>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Upload className="h-4 w-4" /> Subir certificado FNMT
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border-2 border-primary/30 bg-primary/5 p-4"
    >
      <div className="space-y-2">
        <Label>Archivo (.p12 o .pfx) *</Label>
        <Input type="file" name="file" accept=".p12,.pfx" required />
        <p className="text-xs text-muted-foreground">
          Descárgalo de la sede FNMT con tu cuenta digital.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Password del certificado *</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          required
        />
        <p className="text-xs text-muted-foreground">
          El password con el que protegiste el archivo al exportarlo. Lo
          ciframos con AES-256-GCM antes de guardarlo.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Subiendo…" : "Subir y validar"}
        </Button>
      </div>
    </form>
  );
}
