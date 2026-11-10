"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/shared/components/password-input";
import { entrarPortalAction } from "./entrar-actions";

export function EntrarPortalForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dni = String(fd.get("dni") ?? "");
    const clave = String(fd.get("clave") ?? "");
    setError(null);
    startTransition(async () => {
      const r = await entrarPortalAction({ dni, clave });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace("/portal" as never);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="dni" className="text-sm font-medium">
          DNI, NIE o CIF
        </label>
        <input
          id="dni"
          name="dni"
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          placeholder="12345678Z"
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base uppercase ring-offset-background placeholder:normal-case placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="clave" className="text-sm font-medium">
          Contraseña
        </label>
        <PasswordInput id="clave" name="clave" autoComplete="current-password" required />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
