import { type NextRequest, NextResponse } from "next/server";
import { getSignedPhotoUrl } from "@/modules/installations/photo-actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });
  // Validar que el path empieza por company_id (pertenece a una empresa)
  if (!/^[0-9a-f-]{36}\//.test(path)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  try {
    const url = await getSignedPhotoUrl(path);
    if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "error" },
      { status: 500 },
    );
  }
}
