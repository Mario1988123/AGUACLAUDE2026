import type { Metadata } from "next";
import { EntrarPortalForm } from "@/modules/portal-clientes/entrar-form";

export const metadata: Metadata = {
  title: "Área de clientes",
  robots: { index: false, follow: false },
};

const MOTIVOS: Record<string, string> = {
  desactivado: "Tu acceso está desactivado. Llama a tu empresa para que lo revise.",
  salida: "Has cerrado sesión.",
};

export default async function EntrarPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const aviso = motivo ? MOTIVOS[motivo] : null;

  return (
    <div className="marco-px flex min-h-dvh items-center justify-center bg-gradient-to-b from-sky-50 to-white pt-[calc(2rem+var(--safe-top))] pb-[calc(2rem+var(--safe-bottom))] [--marco-pad:1rem]">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-white p-6 shadow-lg sm:p-8">
        <div className="space-y-2 text-center">
          <img src="/brand/logo.svg" alt="Hidromanager" className="mx-auto h-12 w-auto" />
          <h1 className="text-xl font-semibold">Área de clientes</h1>
          <p className="text-sm text-muted-foreground">
            Consulta tus equipos, mantenimientos, contratos y facturas.
          </p>
        </div>
        {aviso && (
          <p className="rounded-md bg-sky-50 px-3 py-2 text-center text-sm text-sky-900">{aviso}</p>
        )}
        <EntrarPortalForm />
        <p className="text-center text-sm text-muted-foreground">
          ¿No tienes contraseña o la has olvidado? Pídesela a la empresa que te instaló el equipo.
        </p>
      </div>
    </div>
  );
}
