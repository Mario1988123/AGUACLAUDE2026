"use client";

import { useState } from "react";
import { createClient } from "@/shared/lib/supabase/client";
import { notify } from "@/shared/hooks/use-toast";

export default function RecuperarPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/restablecer-password`,
    });
    setSubmitting(false);
    if (error) {
      notify.error("No se pudo enviar el correo", error.message);
      return;
    }
    notify.success("Te hemos enviado un correo con instrucciones");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm"
      >
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Te enviaremos un enlace para crear una nueva contraseña.
          </p>
        </div>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@empresa.com"
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Enviando..." : "Enviar enlace"}
        </button>
        <div className="text-center">
          <a href="/login" className="text-sm text-primary hover:underline">
            Volver al inicio de sesión
          </a>
        </div>
      </form>
    </div>
  );
}
