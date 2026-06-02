"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/client";
import { notify } from "@/shared/hooks/use-toast";
import { PasswordInput } from "@/shared/components/password-input";

const loginSchema = z.object({
  email: z.string().email("Email no válido"),
  password: z.string().min(1, "Contraseña obligatoria"),
});

type LoginForm = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") ?? "/";
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginForm) {
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    setSubmitting(false);
    if (error) {
      notify.error("No se pudo iniciar sesión", error.message);
      return;
    }
    notify.success("Sesión iniciada");
    // typedRoutes: el `next` viene del query param y puede ser cualquier ruta interna.
    router.push(next as never);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          {...register("email")}
          id="email"
          type="email"
          autoComplete="email"
          className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="tu@empresa.com"
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Contraseña
        </label>
        <PasswordInput
          {...register("password")}
          id="password"
          autoComplete="current-password"
        />
        {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <img src="/brand/logo.svg" alt="Hidromanager" className="mx-auto h-12 w-auto" />
          <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
        </div>
        <Suspense fallback={<div className="h-32 animate-pulse rounded bg-muted" />}>
          <LoginForm />
        </Suspense>
        <div className="text-center">
          <a href="/recuperar-password" className="text-sm text-primary hover:underline">
            ¿Has olvidado la contraseña?
          </a>
        </div>
      </div>
    </div>
  );
}
