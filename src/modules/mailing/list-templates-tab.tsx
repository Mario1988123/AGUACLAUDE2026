import Link from "next/link";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { listTemplates } from "./actions";

export async function ListTemplatesTab() {
  let rows: Awaited<ReturnType<typeof listTemplates>> = [];
  try {
    rows = await listTemplates();
  } catch {
    /* fail-soft */
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Aún no hay plantillas. Las plantillas del sistema se siembran
          automáticamente al cargar este panel (recarga si no ves nada).
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((t) => (
        <Link
          key={t.id}
          href={`/configuracion/mailing/plantillas/${t.id}` as never}
          className="block"
        >
          <Card className="hover:border-primary/40">
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t.subject}
                  {t.key && (
                    <span className="ml-2 font-mono text-[10px] opacity-60">
                      {t.key}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={t.kind === "marketing" ? "secondary" : "outline"}
                  className="text-xs"
                >
                  {t.kind === "marketing" ? "Marketing" : "Transaccional"}
                </Badge>
                {t.is_system && (
                  <Badge variant="outline" className="text-xs">
                    Sistema
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
