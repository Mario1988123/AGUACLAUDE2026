"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { setGlobalCategoryActiveSafeAction, upsertGlobalCategorySafeAction } from "./actions";
import type { CategoriaTaxonomia } from "./catalogo-taxonomia";
import { estiloCategoria } from "./categorias-estilo";
import {
  CLASE_SELECT,
  RE_CLAVE,
  TIPOS_PRODUCTO,
  claveDesdeNombre,
  etiquetaTipoProducto,
  plural,
} from "./taxonomia-etiquetas";

/**
 * Pestaña «Categorías» del catálogo maestro: árbol madre / hijas con icono y
 * color de categorias-estilo.ts, productos del maestro y atributos de cada una.
 * Crear y editar en una hoja lateral. Nunca se borra: solo se desactiva.
 */

type Editando = { modo: "nueva" } | { modo: "editar"; cat: CategoriaTaxonomia } | null;

export function CategoriasGestor({ categorias }: { categorias: CategoriaTaxonomia[] }) {
  const [verInactivas, setVerInactivas] = useState(false);
  const [editando, setEditando] = useState<Editando>(null);

  const inactivas = categorias.filter((c) => !c.is_active).length;
  const visibles = verInactivas ? categorias : categorias.filter((c) => c.is_active);
  const keys = new Set(visibles.map((c) => c.key));
  // Una hija cuya madre no se ve (desactivada y oculta) sube a primer nivel.
  const raices = visibles.filter((c) => !c.parent_key || !keys.has(c.parent_key));
  const hijasDe = (key: string) => visibles.filter((c) => c.parent_key === key);
  const totalConHijas = (c: CategoriaTaxonomia) =>
    c.productos +
    (c.parent_key
      ? 0
      : categorias.filter((h) => h.parent_key === c.key).reduce((s, h) => s + h.productos, 0));

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Categorías</h1>
          <p className="text-muted-foreground text-sm">
            {plural(categorias.length - inactivas, "categoría activa", "categorías activas")}
            {inactivas > 0 && ` · ${plural(inactivas, "desactivada", "desactivadas")}`}
          </p>
        </div>
        <Button className="h-11" onClick={() => setEditando({ modo: "nueva" })}>
          <Plus className="h-4 w-4" /> Nueva categoría
        </Button>
      </div>

      {inactivas > 0 && (
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={verInactivas}
            onChange={(e) => setVerInactivas(e.target.checked)}
            className="h-5 w-5"
          />
          Mostrar las desactivadas
        </label>
      )}

      {raices.length === 0 ? (
        <div className="bg-muted/30 text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          Sin categorías. Crea la primera.
        </div>
      ) : (
        <ul className="space-y-2">
          {raices.map((c) => {
            const hijas = hijasDe(c.key);
            return (
              <li key={c.id} className="space-y-2">
                <FilaCategoria
                  cat={c}
                  total={totalConHijas(c)}
                  onEditar={() => setEditando({ modo: "editar", cat: c })}
                />
                {hijas.length > 0 && (
                  <ul className="border-border ml-5 space-y-2 border-l-2 pl-3">
                    {hijas.map((h) => (
                      <li key={h.id}>
                        <FilaCategoria
                          cat={h}
                          raiz={c.key}
                          total={h.productos}
                          onEditar={() => setEditando({ modo: "editar", cat: h })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <HojaCategoria
        key={editando ? (editando.modo === "editar" ? editando.cat.id : "nueva") : "cerrada"}
        editando={editando}
        categorias={categorias}
        onCerrar={() => setEditando(null)}
      />
    </div>
  );
}

function FilaCategoria({
  cat,
  raiz,
  total,
  onEditar,
}: {
  cat: CategoriaTaxonomia;
  raiz?: string;
  total: number;
  onEditar: () => void;
}) {
  const e = estiloCategoria(cat.key, raiz ?? cat.parent_key);
  const Icono = e.icono;
  return (
    <button
      type="button"
      onClick={onEditar}
      className={cn(
        "bg-card hover:bg-muted/40 flex w-full min-w-0 items-center gap-3 rounded-xl border p-2 pr-2 text-left transition-colors",
        !cat.is_active && "opacity-60",
      )}
    >
      <span
        className={cn(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          e.tarjeta,
        )}
      >
        <Icono className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold break-words">{cat.name_es}</span>
          {!cat.is_active && (
            <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium">
              Desactivada
            </span>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          <code>{cat.key}</code> · {etiquetaTipoProducto(cat.default_kind)}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 pr-1 text-right text-xs leading-5 tabular-nums">
        <span className="block">{plural(total, "producto", "productos")}</span>
        <span className="block">{plural(cat.atributos, "atributo", "atributos")}</span>
      </span>
      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

function HojaCategoria({
  editando,
  categorias,
  onCerrar,
}: {
  editando: Editando;
  categorias: CategoriaTaxonomia[];
  onCerrar: () => void;
}) {
  const router = useRouter();
  const ask = useConfirm();
  const [pendiente, startTransition] = useTransition();
  const inicial = editando?.modo === "editar" ? editando.cat : null;
  const [form, setForm] = useState({
    name_es: inicial?.name_es ?? "",
    key: inicial?.key ?? "",
    parent_key: inicial?.parent_key ?? "",
    default_kind: inicial?.default_kind ?? "equipment",
    sort_order: inicial?.sort_order ?? 0,
    description_es: inicial?.description_es ?? "",
  });
  const [claveTocada, setClaveTocada] = useState(false);

  const tieneHijas = !!inicial && categorias.some((c) => c.parent_key === inicial.key);
  const enHijas = inicial
    ? categorias.filter((c) => c.parent_key === inicial.key).reduce((s, c) => s + c.productos, 0)
    : 0;
  const madres = useMemo(
    () => categorias.filter((c) => !c.parent_key && c.key !== inicial?.key),
    [categorias, inicial?.key],
  );
  const e = estiloCategoria(inicial?.key ?? null, form.parent_key || null);
  const Icono = e.icono;

  function guardar() {
    const key = form.key.trim();
    if (!form.name_es.trim()) {
      notify.warning("Falta el nombre");
      return;
    }
    if (!inicial && !RE_CLAVE.test(key)) {
      notify.warning("Clave no válida", "Letras, números, guion o guion bajo (2 a 60).");
      return;
    }
    startTransition(async () => {
      const r = await upsertGlobalCategorySafeAction({
        id: inicial?.id,
        key: inicial?.key ?? key,
        name_es: form.name_es,
        description_es: form.description_es,
        default_kind: form.default_kind,
        sort_order: Number.isFinite(form.sort_order) ? form.sort_order : 0,
        parent_key: form.parent_key || null,
      });
      if (!r.ok) {
        notify.error("No se ha guardado la categoría", r.error);
        return;
      }
      notify.success(inicial ? "Categoría guardada" : "Categoría creada");
      onCerrar();
      router.refresh();
    });
  }

  async function cambiarActiva() {
    if (!inicial) return;
    const activar = !inicial.is_active;
    if (!activar) {
      const ok = await ask({
        title: `¿Desactivar «${inicial.name_es}»?`,
        message:
          inicial.productos > 0
            ? `No se borra: sus ${inicial.productos} productos la conservan. Deja de ofrecerse al crear productos y a las empresas.`
            : "No se borra. Deja de ofrecerse al crear productos y a las empresas. Se puede reactivar.",
        confirmText: "Desactivar",
        variant: "destructive",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const r = await setGlobalCategoryActiveSafeAction(inicial.id, activar);
      if (!r.ok) {
        notify.error("No se ha cambiado la categoría", r.error);
        return;
      }
      notify.success(activar ? "Categoría reactivada" : "Categoría desactivada");
      onCerrar();
      router.refresh();
    });
  }

  return (
    <Sheet open={!!editando} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] sm:max-w-md"
      >
        <SheetHeader className="pr-14">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                e.tarjeta,
              )}
            >
              <Icono className="h-5 w-5" aria-hidden="true" />
            </span>
            <SheetTitle className="text-lg">
              {inicial ? inicial.name_es : "Nueva categoría"}
            </SheetTitle>
          </div>
          <SheetDescription>
            {inicial
              ? `${plural(inicial.productos, "producto", "productos")} del maestro${
                  enHijas > 0 ? ` (y ${enHijas} en sus subcategorías)` : ""
                } · ${plural(inicial.atributos, "atributo", "atributos")}`
              : "El icono y el color los pone el equipo técnico; hasta entonces sale en gris o con los de su categoría madre."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-nombre">Nombre</Label>
            <Input
              id="cat-nombre"
              value={form.name_es}
              onChange={(ev) => {
                const name_es = ev.target.value;
                setForm((f) => ({
                  ...f,
                  name_es,
                  key: !inicial && !claveTocada ? claveDesdeNombre(name_es) : f.key,
                }));
              }}
              placeholder="Ósmosis inversa"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-clave">Clave interna</Label>
            <Input
              id="cat-clave"
              value={form.key}
              onChange={(ev) => {
                setClaveTocada(true);
                setForm((f) => ({ ...f, key: ev.target.value }));
              }}
              disabled={!!inicial}
              placeholder="osmosis_inversa"
              className="h-11 font-mono"
            />
            <p className="text-muted-foreground text-xs">
              {inicial
                ? "No se puede cambiar: los productos y las empresas la usan para enlazar."
                : "Se propone sola a partir del nombre. Luego no se puede cambiar."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-madre">Categoría madre</Label>
            <select
              id="cat-madre"
              value={form.parent_key}
              onChange={(ev) => setForm((f) => ({ ...f, parent_key: ev.target.value }))}
              disabled={tieneHijas}
              className={CLASE_SELECT}
            >
              <option value="">Ninguna (primer nivel)</option>
              {madres.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name_es}
                  {!m.is_active ? " (desactivada)" : ""}
                </option>
              ))}
            </select>
            {tieneHijas && (
              <p className="text-muted-foreground text-xs">
                Tiene subcategorías: se queda en primer nivel.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-tipo">Tipo por defecto</Label>
              <select
                id="cat-tipo"
                value={form.default_kind}
                onChange={(ev) => setForm((f) => ({ ...f, default_kind: ev.target.value }))}
                className={CLASE_SELECT}
              >
                {TIPOS_PRODUCTO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-orden">Orden</Label>
              <Input
                id="cat-orden"
                type="number"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(ev) => setForm((f) => ({ ...f, sort_order: Number(ev.target.value) }))}
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">Descripción</Label>
            <Textarea
              id="cat-desc"
              value={form.description_es}
              onChange={(ev) => setForm((f) => ({ ...f, description_es: ev.target.value }))}
              rows={3}
            />
          </div>
        </div>

        {inicial && (
          <div className="grid grid-cols-2 gap-2 px-4">
            <Button asChild variant="outline" className="h-11">
              <Link
                href={
                  `/superadmin/catalogo/productos?cat=${encodeURIComponent(inicial.key)}&vista=lista` as never
                }
              >
                Ver productos
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link
                href={
                  `/superadmin/catalogo/atributos?cat=${encodeURIComponent(inicial.key)}` as never
                }
              >
                Ver atributos
              </Link>
            </Button>
          </div>
        )}

        <SheetFooter className="gap-2">
          <Button className="h-11" onClick={guardar} disabled={pendiente}>
            {pendiente ? "Guardando…" : inicial ? "Guardar cambios" : "Crear categoría"}
          </Button>
          {inicial && (
            <Button
              variant="outline"
              className={cn("h-11", inicial.is_active && "text-destructive")}
              onClick={cambiarActiva}
              disabled={pendiente}
            >
              {inicial.is_active ? "Desactivar" : "Reactivar"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
