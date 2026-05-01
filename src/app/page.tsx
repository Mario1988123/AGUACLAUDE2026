import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Si es superadmin, al panel
  const claims = user.app_metadata as { is_superadmin?: boolean } | undefined;
  if (claims?.is_superadmin) {
    redirect("/superadmin");
  }

  redirect("/dashboard");
}
