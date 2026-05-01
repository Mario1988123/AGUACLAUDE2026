import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";

export default async function HomePage() {
  // Dev local autologin: directo al superadmin
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true"
  ) {
    redirect("/superadmin");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const claims = user.app_metadata as { is_superadmin?: boolean } | undefined;
  if (claims?.is_superadmin) {
    redirect("/superadmin");
  }

  redirect("/dashboard");
}
