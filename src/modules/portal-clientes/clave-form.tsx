"use client";

import { useRef, useState, useTransition } from "react";
import { PasswordInput } from "@/shared/components/password-input";
import { cambiarClavePortalAction } from "./entrar-actions";

export function CambiarClavePortalForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const actual = String(fd.get("actual") ?? "");
    const nueva = String(fd.get("nueva") ?? "");
    const repetir = String(fd.get("repetir") ?? "");
    setError(null);
    setHecho(false);
    if (nueva !== repetir) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    startTransition(async () => {
      const r = await cambiarClavePortalAction({ actual, nueva });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      formRef.current?.reset();
      setHecho(true);
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="actual" className="text-sm font-medium">
          Contraseña actual
        </label>
        <PasswordInput id="actual" name="actual" autoComplete="current-password" required />
      </div>
      <div className="space-y-2">
        <label htmlFor="nueva" className="text-sm font-medium">
          Contraseña nueva
        </label>
        <PasswordInput id="nueva" name="nueva" autoComplete="new-password" minLength={10} required />
      </div>
      <div className="space-y-2">
        <label htmlFor="repetir" className="text-sm font-medium">
          Repite la contraseña nueva
        </label>
        <PasswordInput id="repetir" name="repetir" autoComplete="new-password" minLength={10} required />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {hecho && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Contraseña cambiada. La próxima vez entra con la nueva.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
