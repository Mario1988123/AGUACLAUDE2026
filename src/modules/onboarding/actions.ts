"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Marca el onboarding como completado para el usuario actual. El flag vive
 * en user_profiles.has_seen_onboarding y onboarding_completed_at (migración
 * 20260502140000).
 */
export async function markOnboardingDoneAction(): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("user_profiles")
    .update({
      has_seen_onboarding: true,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("user_id", session.user_id);
}

/** Resetea el flag para volver a mostrar el tour la próxima vez. */
export async function replayOnboardingAction(): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("user_profiles")
    .update({
      has_seen_onboarding: false,
      onboarding_completed_at: null,
    })
    .eq("user_id", session.user_id);
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("user_profiles")
    .select("has_seen_onboarding")
    .eq("user_id", session.user_id)
    .maybeSingle();
  return Boolean((data as { has_seen_onboarding: boolean } | null)?.has_seen_onboarding);
}
