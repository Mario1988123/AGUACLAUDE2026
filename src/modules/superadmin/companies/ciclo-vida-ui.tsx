"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle, Ban, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  cambiarEstadoEmpresaSafeAction,
  borrarEmpresaDefinitivaSafeAction,
  type AccionEstadoEmpresa,
} from "./ciclo-vida-actions";

const TEXTO_ACCION: Record<
  AccionEstadoEmpresa,
  { titulo: string; mensaje: (n: string) => string; boton: string; hecho: string; variante: "warning" | "destructive" | "success" }
> = {
  pausar: {
    titulo: "Pausar la empresa",
    mensaje: (n) =>
      `Nadie de «${n}» podrá entrar mientras esté pausada; al intentarlo verán un aviso. Los datos no se tocan y puedes reactivarla cuando quieras.`,
    boton: "Pausar",
    hecho: "Empresa pausada",
    variante: "warning",
  },
  dar_baja: {
    titulo: "Dar de baja la empresa",
    mensaje: (n) =>
      `«${n}» se queda sin acceso y queda marcada como baja con la fecha de hoy. Los datos se conservan; se puede reactivar o, más adelante, borrar.`,
    boton: "Dar de baja",
    hecho: "Empresa dada de baja",
    variante: "destructive",
  },
  reactivar: {
    titulo: "Reactivar la empresa",
    mensaje: (n) => `Los usuarios de «${n}» vuelven a poder entrar desde ahora.`,
    boton: "Reactivar",
    hecho: "Empresa activa",
    variante: "success",
  },
};

function useCambiarEstado(companyId: string, nombre: string) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  async function ejecutar(accion: AccionEstadoEmpresa) {
    const t = TEXTO_ACCION[accion];
    const ok = await confirm({
      title: t.titulo,
      message: t.mensaje(nombre),
      confirmText: t.boton,
      variant: t.variante,
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await cambiarEstadoEmpresaSafeAction(companyId, accion);
      if (!r.ok) {
        notify.error("No se pudo cambiar el estado", r.error);
        return;
      }
      notify.success(t.hecho);
      router.refresh();
    });
  }
  return { ejecutar, pending };
}

/** Acciones rápidas de la tarjeta de la lista: pausar o reactivar. */
export function AccionesRapidasEmpresa({
  companyId,
  nombre,
  status,
}: {
  companyId: string;
  nombre: string;
  status: string;
}) {
  const { ejecutar, pending } = useCambiarEstado(companyId, nombre);
  if (status === "suspended" || status === "cancelled") {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11 flex-1"
        disabled={pending}
        onClick={() => ejecutar("reactivar")}
      >
        <PlayCircle className="h-4 w-4" aria-hidden="true" />
        Reactivar
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 flex-1"
      disabled={pending}
      onClick={() => ejecutar("pausar")}
    >
      <PauseCircle className="h-4 w-4" aria-hidden="true" />
      Pausar
    </Button>
  );
}

interface ZonaPeligrosaProps {
  companyId: string;
  nombre: string;
  status: string;
  protegida: boolean;
  recuento: { usuarios: number; clientes: number; contratos: number };
}

/** «Zona peligrosa» del detalle: pausar, dar de baja, reactivar y borrar. */
export function ZonaPeligrosaEmpresa({
  companyId,
  nombre,
  status,
  protegida,
  recuento,
}: ZonaPeligrosaProps) {
  const router = useRouter();
  const { ejecutar, pending } = useCambiarEstado(companyId, nombre);
  const [abierto, setAbierto] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [borrando, startBorrado] = useTransition();

  const puedeBorrar = !protegida && status !== "active";
  const nombreOk = escrito.trim() === nombre.trim() && nombre.trim().length > 0;

  function borrar() {
    if (!nombreOk) return;
    startBorrado(async () => {
      const r = await borrarEmpresaDefinitivaSafeAction(companyId, escrito);
      if (!r.ok) {
        notify.error("No se pudo borrar la empresa", r.error);
        return;
      }
      const s = r.resumen;
      const avisos: string[] = [];
      if (s.ficheros_fallidos > 0) avisos.push(`${s.ficheros_fallidos} ficheros no se borraron`);
      if (s.usuarios_fallidos > 0) avisos.push(`${s.usuarios_fallidos} cuentas no se borraron`);
      notify.success(
        `«${s.name}» borrada`,
        `${s.filas} filas, ${s.ficheros_borrados} ficheros y ${s.usuarios_borrados} cuentas.` +
          (avisos.length ? ` Ojo: ${avisos.join(" y ")} (queda en la auditoría).` : ""),
      );
      setAbierto(false);
      router.push("/superadmin");
      router.refresh();
    });
  }

  const fila =
    "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between";

  return (
    <div className="divide-y">
      {status === "suspended" || status === "cancelled" || status === "trial" ? (
        <div className={fila}>
          <div className="min-w-0">
            <p className="font-medium">{status === "trial" ? "Pasar a activa" : "Reactivar"}</p>
            <p className="text-sm text-muted-foreground">
              {status === "trial"
                ? "Termina el periodo de prueba; todo sigue igual."
                : "Los usuarios vuelven a entrar desde ese momento."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:w-44"
            disabled={pending}
            onClick={() => ejecutar("reactivar")}
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            {status === "trial" ? "Activar" : "Reactivar"}
          </Button>
        </div>
      ) : null}

      {status !== "suspended" && status !== "cancelled" ? (
        <div className={fila}>
          <div className="min-w-0">
            <p className="font-medium">Pausar el plan</p>
            <p className="text-sm text-muted-foreground">
              Nadie de la empresa puede entrar; ven un aviso. No se toca ningún dato.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 border-warning/50 text-warning hover:bg-warning/10 sm:w-44"
            disabled={pending}
            onClick={() => ejecutar("pausar")}
          >
            <PauseCircle className="h-4 w-4" aria-hidden="true" />
            Pausar
          </Button>
        </div>
      ) : null}

      {status !== "cancelled" ? (
        <div className={fila}>
          <div className="min-w-0">
            <p className="font-medium">Dar de baja</p>
            <p className="text-sm text-muted-foreground">
              Sin acceso y con fecha de baja. Los datos se conservan.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-44"
            disabled={pending}
            onClick={() => ejecutar("dar_baja")}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Dar de baja
          </Button>
        </div>
      ) : null}

      <div className={fila}>
        <div className="min-w-0">
          <p className="font-medium">Borrar la empresa</p>
          <p className="text-sm text-muted-foreground">
            {protegida ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
                Empresa protegida: no se puede borrar.
              </span>
            ) : status === "active" ? (
              "Para borrarla, primero páusala o dala de baja."
            ) : (
              "Borra todos sus datos, ficheros y cuentas. No se puede deshacer."
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="h-11 sm:w-44"
          disabled={!puedeBorrar || borrando}
          onClick={() => {
            setEscrito("");
            setAbierto(true);
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Borrar
        </Button>
      </div>

      <Dialog open={abierto} onOpenChange={(v) => !borrando && setAbierto(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Borrar «{nombre}» para siempre</DialogTitle>
            <DialogDescription>
              Se borran todos sus datos ({recuento.usuarios} usuarios, {recuento.clientes} clientes,{" "}
              {recuento.contratos} contratos activos y todo lo demás), sus ficheros y las cuentas
              que solo eran de esta empresa. No hay papelera ni copia: no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirmar-nombre">
              Escribe <span className="font-semibold">{nombre}</span> para confirmar
            </Label>
            <Input
              id="confirmar-nombre"
              value={escrito}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setEscrito(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={borrando}
              onClick={() => setAbierto(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={!nombreOk || borrando}
              onClick={borrar}
            >
              {borrando ? "Borrando…" : "Borrar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
