import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Dev local autologin: directo al superadmin
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true"
  ) {
    redirect("/superadmin");
  }

  const session = await requireSession();
  if (session.is_superadmin) redirect("/superadmin");
  redirect("/dashboard");
}
