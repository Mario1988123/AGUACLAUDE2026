import { listCategories, listGlobalCategories } from "@/modules/products/actions";
import { listAttributes } from "@/modules/products/attributes-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CloneCategoryButton, CreateCategoryForm } from "@/modules/products/categories-panel";
import { AttributesConfig } from "@/modules/config/products/attributes-config";
import { KIND_LABEL } from "@/modules/products/schemas";
import { listUnits } from "@/modules/config/units/actions";
import { UnitsManager } from "@/modules/config/units/units-manager";

export const dynamic = "force-dynamic";

export default async function ConfiguracionProductosPage() {
  const [local, globals, attributes, units] = await Promise.all([
    listCategories(),
    listGlobalCategories(),
    listAttributes(),
    listUnits(),
  ]);
  const clonedIds = new Set(local.map((c) => c.cloned_from_global_id).filter(Boolean));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración · Productos</h1>
        <p className="text-sm text-muted-foreground">
          Categorías y atributos. Puedes precargar las del catálogo global del SaaS o crear las
          tuyas propias.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mis categorías ({local.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {local.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no tienes categorías. Precarga del catálogo global o crea las tuyas.
              </p>
            ) : (
              <ul className="divide-y">
                {local.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABEL[c.default_kind]}
                        {c.cloned_from_global_id && " · Precargada del catálogo"}
                      </div>
                    </div>
                    {c.is_active ? (
                      <Badge variant="success">Activa</Badge>
                    ) : (
                      <Badge variant="secondary">Inactiva</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold">Crear categoría</h3>
              <CreateCategoryForm />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catálogo global del SaaS</CardTitle>
          </CardHeader>
          <CardContent>
            {globals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                El superadmin todavía no ha definido categorías globales.
              </p>
            ) : (
              <ul className="divide-y">
                {globals.map((g) => {
                  const alreadyCloned = clonedIds.has(g.id);
                  return (
                    <li key={g.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-sm font-medium">{g.name_es}</div>
                        <div className="text-xs text-muted-foreground">
                          {KIND_LABEL[g.default_kind]} · {g.key}
                        </div>
                      </div>
                      <CloneCategoryButton
                        globalCategoryId={g.id}
                        alreadyCloned={alreadyCloned}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unidades ({units.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <UnitsManager units={units} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Atributos ({attributes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <AttributesConfig
            attributes={attributes}
            categories={local}
            units={units.map((u) => ({ code: u.code, label: u.label }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
