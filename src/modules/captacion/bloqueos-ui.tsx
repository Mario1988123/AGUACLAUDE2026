"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { anadirBloqueoAction, quitarBloqueoAction, type BloqueoFila } from "./bloqueos-actions";

const SELECT =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring";

const MOTIVO: Record<BloqueoFila["motivo"], string> = {
  boton_no: "Pulsó «No, gracias»",
  baja_texto: "Pidió la baja por escrito",
  queja: "Queja",
  manual: "Añadido a mano",
  cliente: "Es cliente",
};

const fecha = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" });

function formatoValor(b: BloqueoFila): string {
  if (b.ambito !== "telefono") return "Usuario de WhatsApp sin teléfono";
  const d = b.valor.replace("+34", "");
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : b.valor;
}

export function AnadirBloqueo() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [telefono, setTelefono] = useState("");
  const [motivo, setMotivo] = useState<"manual" | "queja" | "cliente">("manual");

  function anadir() {
    start(async () => {
      const r = await anadirBloqueoAction({ telefono, motivo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.aviso) toast.info(r.aviso);
      else toast.success("Teléfono bloqueado: no se le escribirá desde captación.");
      setTelefono("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-base font-bold">Añadir un teléfono</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bl-tel">Teléfono</Label>
          <Input
            id="bl-tel"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="600 11 22 33"
            className="text-base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bl-motivo">Motivo</Label>
          <select
            id="bl-motivo"
            className={SELECT}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as typeof motivo)}
          >
            <option value="manual">Pidió que no le escribiéramos</option>
            <option value="queja">Queja</option>
            <option value="cliente">Ya es cliente</option>
          </select>
        </div>
      </div>
      <Button className="h-12 w-full sm:w-auto" disabled={pending || telefono.replace(/\D/g, "").length < 9} onClick={anadir}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Bloquear
      </Button>
    </section>
  );
}

export function ListaBloqueos({ bloqueos, puedeQuitar }: { bloqueos: BloqueoFila[]; puedeQuitar: boolean }) {
  if (bloqueos.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No hay ningún teléfono bloqueado.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {bloqueos.map((b) => (
        <FilaBloqueo key={b.id} b={b} puedeQuitar={puedeQuitar} />
      ))}
    </ul>
  );
}

function FilaBloqueo({ b, puedeQuitar }: { b: BloqueoFila; puedeQuitar: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-medium tabular-nums">{formatoValor(b)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[b.negocio, MOTIVO[b.motivo] ?? b.motivo, fecha.format(new Date(b.created_at))].filter(Boolean).join(" · ")}
        </div>
      </div>
      {puedeQuitar ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={pending} aria-label="Quitar de la lista">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar este bloqueo?</AlertDialogTitle>
              <AlertDialogDescription>
                {b.motivo === "boton_no" || b.motivo === "baja_texto"
                  ? "Esta persona pidió que no le escribiéramos. Quítalo solo si te lo ha pedido ella."
                  : "Se le podrá volver a escribir desde una campaña."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  start(async () => {
                    const r = await quitarBloqueoAction(b.id);
                    if (!r.ok) toast.error(r.error);
                    else toast.success("Bloqueo quitado");
                    router.refresh();
                  })
                }
              >
                Sí, quitar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </li>
  );
}
