"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, KeyRound } from "lucide-react";
import { createClient } from "@/shared/lib/supabase/client";
import { notify } from "@/shared/hooks/use-toast";
import { markPasswordChangedAction } from "@/modules/auth/password-actions";

export default function RestablecerPasswordPage() {
  // Next 15 exige Suspense alrededor de useSearchParams para SSG.
  return (
    <Suspense fallback={null}>
      <RestablecerPasswordInner />
    </Suspense>
  );
}

function RestablecerPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const required = searchParams.get("required") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      notify.warning("Escribe una contraseña");
      return;
    }
    if (password !== confirm) {
      notify.warning("Las contraseñas no coinciden");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      notify.error("No se pudo cambiar la contraseña", error.message);
      return;
    }
    // Marcar must_change_password=false en user_profiles para que el
    // guard ya no fuerce el redirect en próximas navegaciones.
    try {
      await markPasswordChangedAction();
    } catch (err) {
      // No bloqueamos por esto — el cambio de password en auth.users
      // ya tuvo éxito. Lo loggeamos para diagnóstico.
      console.error("[restablecer-password] markPasswordChanged failed:", err);
    }
    setSubmitting(false);
    notify.success("Contraseña actualizada");
    router.push("/");
    // Refresh para que requireSession lea el nuevo estado
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-lg border bg-card p-8 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              required ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
            }`}
          >
            {required ? (
              <ShieldAlert className="h-6 w-6" />
            ) : (
              <KeyRound className="h-6 w-6" />
            )}
          </div>
          <h1 className="text-2xl font-bold">
            {required ? "Cambia tu contraseña" : "Nueva contraseña"}
          </h1>
          {required && (
            <p className="text-sm text-muted-foreground">
              La contraseña actual es <strong>temporal</strong>. Por seguridad,
              debes establecer una contraseña nueva antes de continuar.
            </p>
          )}
        </div>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nueva contraseña"
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
        <p className="text-center text-xs text-muted-foreground">
          Elige la contraseña que prefieras. Recuerda guardarla.
        </p>
      </form>
    </div>
  );
}
