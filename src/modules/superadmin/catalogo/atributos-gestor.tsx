"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Search, X } from "lucide-react";
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
import { deleteGlobalAttributeSafeAction, guardarAtributoGlobalSafeAction } from "./actions";
import type { AtributoTaxonomia, CategoriaTaxonomia } from "./catalogo-taxonomia";
import { estiloCategoria } from "./categorias-estilo";
import {
  CLASE_SELECT,
  GRUPOS_ATRIBUTO,
  RE_CLAVE,
  TIPOS_DATO,
  claveDesdeNombre,
  etiquetaTipoDato,
  plural,
} from "./taxonomia-etiquetas";

/**
 * Pestaña «Atributos» del catálogo maestro. Lo principal es el filtro por
 * CATEGORÍA: ver qué atributos tiene cada categoría y crear los suyos (el
 * atributo nuevo nace ya enlazado a la categoría filtrada). Agrupados por
 * grupo de la ficha (Físicas, Eléctricas, Técnicas, Extra).
 *
 * Sustituye a AttributesPanel + AttributeCategoriesDialog de manager.tsx: las
 * categorías de cada atributo llegan ya del servidor, así que no hay fetch ni
 * setState durante el render (docs/PLAN_CATALOGO_MAESTRO.md §B.6).
 */

const SIN_CATEGORIA = "__sin__";

type Editando = { modo: "nuevo" } | { modo: "editar"; attr: AtributoTaxonomia } | null;

/** Escribe el filtro en la URL sin navegar (para que sobreviva a recargar). */
function reflejarEnUrl(cat: string, q: string) {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (cat) sp.set("cat", cat);
    else sp.delete("cat");
    if (q) sp.set("q", q);
    else sp.delete("q");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  } catch {
    // Sin historial (vista previa): el filtro sigue funcionando en memoria.
  }
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function AtributosGestor({
  atributos,
  categorias,
  catInicial,
  qInicial,
}: {
  atributos: AtributoTaxonomia[];
  categorias: CategoriaTaxonomia[];
  catInicial: string;
  qInicial: string;
}) {
  const [cat, setCat] = useState(
    catInicial === SIN_CATEGORIA || categorias.some((c) => c.key === catInicial) ? catInicial : "",
  );
  const [q, setQ] = useState(qInicial);
  const [editando, setEditando] = useState<Editando>(null);

  const porKey = useMemo(() => new Map(categorias.map((c) => [c.key, c])), [categorias]);
  const opcionesCat = useMemo(() => {
    const raices = categorias.filter((c) => !c.parent_key || !porKey.has(c.parent_key));
    return raices.flatMap((r) => [
      { key: r.key, label: r.name_es + (r.is_active ? "" : " (desactivada)") },
      ...categorias
        .filter((h) => h.parent_key === r.key)
        .map((h) => ({
          key: h.key,
          label: `— ${h.name_es}${h.is_active ? "" : " (desactivada)"}`,
        })),
    ]);
  }, [categorias, porKey]);

  const catSel = cat && cat !== SIN_CATEGORIA ? (porKey.get(cat) ?? null) : null;
  const qn = normalizar(q.trim());
  const filtrados = atributos.filter((a) => {
    if (cat === SIN_CATEGORIA ? a.categorias.length > 0 : cat && !a.categorias.includes(cat))
      return false;
    if (!qn) return true;
    return normalizar(`${a.name_es} ${a.key} ${a.unit ?? ""}`).includes(qn);
  });
  const bloques = GRUPOS_ATRIBUTO.map((g) => ({
    ...g,
    filas: filtrados.filter((a) =>
      g.valor === "tecnicas"
        ? !a.grupo || !GRUPOS_ATRIBUTO.some((x) => x.valor === a.grupo) || a.grupo === "tecnicas"
        : a.grupo === g.valor,
    ),
  })).filter((b) => b.filas.length > 0);

  function cambiarCat(v: string) {
    setCat(v);
    reflejarEnUrl(v, q.trim());
  }
  function cambiarQ(v: string) {
    setQ(v);
    reflejarEnUrl(cat, v.trim());
  }

  const estiloSel = catSel ? estiloCategoria(catSel.key, catSel.parent_key) : null;
  const IconoSel = estiloSel?.icono;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Atributos</h1>
          <p className="text-muted-foreground text-sm">
            {plural(atributos.length, "atributo global", "atributos globales")} · las
            características de la ficha técnica
          </p>
        </div>
        <Button className="h-11" onClick={() => setEditando({ modo: "nuevo" })}>
          <Plus className="h-4 w-4" />
          {catSel ? `Nuevo en ${catSel.name_es}` : "Nuevo atributo"}
        </Button>
      </div>

      {/* Filtro por categoría: lo principal de la pantalla */}
      <div
        className={cn(
          "space-y-3 rounded-2xl p-3 sm:p-4",
          estiloSel ? estiloSel.tarjeta : "bg-muted/50",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              estiloSel ? estiloSel.icono_cls : "bg-card text-muted-foreground",
            )}
          >
            {IconoSel ? (
              <IconoSel className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Search className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <Label
              htmlFor="filtro-cat"
              className="text-xs font-semibold tracking-wide uppercase opacity-80"
            >
              Categoría
            </Label>
            <select
              id="filtro-cat"
              value={cat}
              onChange={(e) => cambiarCat(e.target.value)}
              className={cn(CLASE_SELECT, "text-foreground font-semibold")}
            >
              <option value="">Todas las categorías</option>
              <option value={SIN_CATEGORIA}>Sin categoría</option>
              {opcionesCat.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => cambiarQ(e.target.value)}
            placeholder="Buscar por nombre, clave o unidad"
            aria-label="Buscar atributo"
            className="bg-background h-11 pr-10 pl-9 text-base md:text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => cambiarQ("")}
              aria-label="Borrar búsqueda"
              className="text-muted-foreground absolute top-0 right-0 inline-flex h-11 w-11 items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-sm">
          {catSel ? (
            <>
              <strong>{plural(filtrados.length, "atributo", "atributos")}</strong> en{" "}
              {catSel.name_es}. Los que crees ahora nacen ya enlazados a esta categoría.
            </>
          ) : cat === SIN_CATEGORIA ? (
            <>
              <strong>{plural(filtrados.length, "atributo", "atributos")}</strong> sin ninguna
              categoría: no salen al editar ninguna ficha por categoría.
            </>
          ) : (
            <>
              <strong>{plural(filtrados.length, "atributo", "atributos")}</strong>
              {qn ? " con esa búsqueda" : ""}. Elige una categoría para ver y crear los suyos.
            </>
          )}
        </p>
      </div>

      {bloques.length === 0 ? (
        <div className="bg-muted/30 text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {catSel
            ? `${catSel.name_es} aún no tiene atributos.`
            : "Ningún atributo cumple el filtro."}
        </div>
      ) : (
        bloques.map((b) => (
          <section key={b.valor} className="space-y-2">
            <h2 className="text-muted-foreground flex items-baseline gap-2 text-sm font-bold tracking-wide uppercase">
              {b.label}
              <span className="font-medium tabular-nums">{b.filas.length}</span>
            </h2>
            <ul className="space-y-2">
              {b.filas.map((a) => (
                <li key={a.id}>
                  <FilaAtributo
                    attr={a}
                    porKey={porKey}
                    catFiltro={catSel?.key ?? null}
                    onEditar={() => setEditando({ modo: "editar", attr: a })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <HojaAtributo
        key={
          editando ? (editando.modo === "editar" ? editando.attr.id : `nuevo-${cat}`) : "cerrada"
        }
        editando={editando}
        categorias={categorias}
        opcionesCat={opcionesCat}
        catPorDefecto={catSel?.key ?? null}
        onCerrar={() => setEditando(null)}
      />
    </div>
  );
}

function FilaAtributo({
  attr,
  porKey,
  catFiltro,
  onEditar,
}: {
  attr: AtributoTaxonomia;
  porKey: Map<string, CategoriaTaxonomia>;
  catFiltro: string | null;
  onEditar: () => void;
}) {
  // La categoría filtrada va primero; el resto, hasta 3 píldoras y «+n».
  const orden = [...attr.categorias].sort((x, y) =>
    x === catFiltro ? -1 : y === catFiltro ? 1 : 0,
  );
  const visibles = orden.slice(0, 3);
  const resto = orden.length - visibles.length;
  return (
    <button
      type="button"
      onClick={onEditar}
      className="bg-card hover:bg-muted/40 flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors"
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold break-words">{attr.name_es}</span>
          <span className="text-muted-foreground text-xs">
            {etiquetaTipoDato(attr.data_type)}
            {attr.unit ? ` · ${attr.unit}` : ""}
            {attr.data_type === "enum" && attr.enum_values?.length
              ? ` · ${plural(attr.enum_values.length, "valor", "valores")}`
              : ""}
          </span>
        </span>
        <code className="text-muted-foreground block truncate text-xs">{attr.key}</code>
        <span className="flex flex-wrap gap-1">
          {visibles.length === 0 ? (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              Sin categoría
            </span>
          ) : (
            visibles.map((k) => {
              const c = porKey.get(k);
              const e = estiloCategoria(k, c?.parent_key);
              return (
                <span
                  key={k}
                  className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", e.pildora)}
                >
                  {c?.name_es ?? k}
                </span>
              );
            })
          )}
          {resto > 0 && (
            <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium">
              +{resto}
            </span>
          )}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 text-right text-xs leading-5 tabular-nums">
        <span className="text-foreground block text-base font-bold">
          {attr.productos.toLocaleString("es-ES")}
        </span>
        {attr.productos === 1 ? "producto" : "productos"}
      </span>
      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
  );
}

function HojaAtributo({
  editando,
  categorias,
  opcionesCat,
  catPorDefecto,
  onCerrar,
}: {
  editando: Editando;
  categorias: CategoriaTaxonomia[];
  opcionesCat: Array<{ key: string; label: string }>;
  catPorDefecto: string | null;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const ask = useConfirm();
  const [pendiente, startTransition] = useTransition();
  const inicial = editando?.modo === "editar" ? editando.attr : null;
  const [form, setForm] = useState({
    name_es: inicial?.name_es ?? "",
    key: inicial?.key ?? "",
    grupo: inicial?.grupo ?? "",
    data_type: inicial?.data_type ?? "text",
    unit: inicial?.unit ?? "",
    valores: (inicial?.enum_values ?? []).join("\n"),
    sort_order: inicial?.sort_order ?? 0,
    description_es: inicial?.description_es ?? "",
  });
  const [seleccion, setSeleccion] = useState<Set<string>>(
    () => new Set(inicial ? inicial.categorias : catPorDefecto ? [catPorDefecto] : []),
  );
  const [claveTocada, setClaveTocada] = useState(false);
  const porKey = useMemo(() => new Map(categorias.map((c) => [c.key, c])), [categorias]);

  const cambiaTipo = !!inicial && inicial.productos > 0 && form.data_type !== inicial.data_type;

  function alternar(key: string) {
    setSeleccion((cur) => {
      const n = new Set(cur);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

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
    const valores = form.valores
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
    if (form.data_type === "enum" && valores.length === 0) {
      notify.warning("Faltan los valores", "Escribe al menos un valor, uno por línea.");
      return;
    }
    startTransition(async () => {
      const r = await guardarAtributoGlobalSafeAction({
        id: inicial?.id,
        key: inicial?.key ?? key,
        name_es: form.name_es,
        description_es: form.description_es || null,
        data_type: form.data_type,
        unit: form.unit,
        grupo: form.grupo || null,
        enum_values: form.data_type === "enum" ? valores : null,
        sort_order: Number.isFinite(form.sort_order) ? form.sort_order : 0,
        categorias: Array.from(seleccion),
      });
      if (!r.ok) {
        notify.error("No se ha guardado el atributo", r.error);
        return;
      }
      notify.success(inicial ? "Atributo guardado" : "Atributo creado");
      onCerrar();
      router.refresh();
    });
  }

  async function borrar() {
    if (!inicial) return;
    const ok = await ask({
      title: `¿Borrar «${inicial.name_es}»?`,
      message: "Ningún producto del maestro lo usa. Se quita también de sus categorías.",
      confirmText: "Borrar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteGlobalAttributeSafeAction(inicial.id);
      if (!r.ok) {
        notify.error("No se ha borrado el atributo", r.error);
        return;
      }
      notify.success("Atributo borrado");
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
          <SheetTitle className="text-lg">
            {inicial ? inicial.name_es : "Nuevo atributo"}
          </SheetTitle>
          <SheetDescription>
            {inicial
              ? `Lo usan ${plural(inicial.productos, "producto", "productos")} del maestro.`
              : "Una característica de la ficha técnica (caudal, potencia, medidas…)."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-1.5">
            <Label htmlFor="attr-nombre">Nombre</Label>
            <Input
              id="attr-nombre"
              value={form.name_es}
              onChange={(ev) => {
                const name_es = ev.target.value;
                setForm((f) => ({
                  ...f,
                  name_es,
                  key: !inicial && !claveTocada ? claveDesdeNombre(name_es) : f.key,
                }));
              }}
              placeholder="Caudal de producción"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-clave">Clave interna</Label>
            <Input
              id="attr-clave"
              value={form.key}
              onChange={(ev) => {
                setClaveTocada(true);
                setForm((f) => ({ ...f, key: ev.target.value }));
              }}
              disabled={!!inicial}
              placeholder="caudal_produccion"
              className="h-11 font-mono"
            />
            <p className="text-muted-foreground text-xs">
              {inicial
                ? "No se puede cambiar: los valores de los productos cuelgan de ella."
                : "Se propone sola a partir del nombre. Luego no se puede cambiar."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="attr-grupo">Grupo</Label>
              <select
                id="attr-grupo"
                value={form.grupo}
                onChange={(ev) => setForm((f) => ({ ...f, grupo: ev.target.value }))}
                className={CLASE_SELECT}
              >
                <option value="">Sin grupo (Técnicas)</option>
                {GRUPOS_ATRIBUTO.map((g) => (
                  <option key={g.valor} value={g.valor}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attr-tipo">Tipo</Label>
              <select
                id="attr-tipo"
                value={form.data_type}
                onChange={(ev) => setForm((f) => ({ ...f, data_type: ev.target.value }))}
                className={CLASE_SELECT}
              >
                {TIPOS_DATO.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {cambiaTipo && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              Lo usan {plural(inicial.productos, "producto", "productos")}: al cambiar el tipo, sus
              valores guardados pueden dejar de verse en la ficha.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="attr-unidad">Unidad</Label>
              <Input
                id="attr-unidad"
                value={form.unit}
                onChange={(ev) => setForm((f) => ({ ...f, unit: ev.target.value }))}
                placeholder="L/h"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attr-orden">Orden</Label>
              <Input
                id="attr-orden"
                type="number"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(ev) => setForm((f) => ({ ...f, sort_order: Number(ev.target.value) }))}
                className="h-11"
              />
            </div>
          </div>
          {form.data_type === "enum" && (
            <div className="space-y-1.5">
              <Label htmlFor="attr-valores">Valores de la lista</Label>
              <Textarea
                id="attr-valores"
                value={form.valores}
                onChange={(ev) => setForm((f) => ({ ...f, valores: ev.target.value }))}
                rows={5}
                placeholder={"Uno por línea\nBajo encimera\nSobre encimera"}
              />
              <p className="text-muted-foreground text-xs">
                Uno por línea. Los repetidos se quitan solos.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="attr-desc">Descripción</Label>
            <Textarea
              id="attr-desc"
              value={form.description_es}
              onChange={(ev) => setForm((f) => ({ ...f, description_es: ev.target.value }))}
              rows={2}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Categorías <span className="text-muted-foreground">({seleccion.size})</span>
            </legend>
            <p className="text-muted-foreground text-xs">
              El atributo sale al editar las fichas de estas categorías.
            </p>
            <div className="space-y-1.5">
              {opcionesCat.map((o) => {
                const c = porKey.get(o.key);
                const e = estiloCategoria(o.key, c?.parent_key);
                const Icono = e.icono;
                const marcada = seleccion.has(o.key);
                return (
                  <label
                    key={o.key}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 px-2.5 py-1.5",
                      marcada ? "border-primary bg-primary/5" : "border-border",
                      c?.parent_key && "ml-5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() => alternar(o.key)}
                      className="h-5 w-5 shrink-0"
                    />
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        e.tarjeta,
                      )}
                    >
                      <Icono className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium break-words">
                      {c?.name_es ?? o.key}
                      {c && !c.is_active && (
                        <span className="text-muted-foreground"> (desactivada)</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        <SheetFooter className="gap-2">
          <Button className="h-11" onClick={guardar} disabled={pendiente}>
            {pendiente ? "Guardando…" : inicial ? "Guardar cambios" : "Crear atributo"}
          </Button>
          {inicial && inicial.productos === 0 && (
            <Button
              variant="outline"
              className="text-destructive h-11"
              onClick={borrar}
              disabled={pendiente}
            >
              Borrar atributo
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
