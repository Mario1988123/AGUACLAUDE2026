import { listMessageTemplatesAdmin } from "@/modules/messaging/actions";
import { MessageTemplatesManager } from "@/modules/messaging/templates-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPlantillasPage() {
  const items = await listMessageTemplatesAdmin().catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Plantillas de mensaje</h1>
        <p className="text-sm text-muted-foreground">
          Plantillas de WhatsApp y Email que aparecen en las fichas de leads y clientes para que
          los comerciales envíen mensajes con un clic.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plantillas ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageTemplatesManager items={items} />
        </CardContent>
      </Card>
    </div>
  );
}
