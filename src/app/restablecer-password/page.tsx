"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/client";
import { notify } from "@/shared/hooks/use-toast";

export default function RestablecerPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) {
      notify.warning("La contraseña debe tener al menos 12 caracteres");
      return;
    }
    if (password !== confirm) {
      notify.warning("Las contraseñas no coinciden");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      notify.error("No se pudo cambiar la contraseña", error.message);
      return;
    }
    notify.success("Contraseña actualizada");
    router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm"
      >
        <h1 className="text-center text-2xl font-bold">Nueva contraseña</h1>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 12 caracteres"
          autoComplete="new-password"
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repite la contraseña"
          autoComplete="new-password"
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Guardando..." : "Guardar contraseña"}
        </button>
      </form>
    </div>
  );
}
