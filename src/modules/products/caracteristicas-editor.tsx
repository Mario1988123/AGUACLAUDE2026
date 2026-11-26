"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { formatearNumero } from "@/modules/superadmin/catalogo/catalogo-etiquetas";
import {
  anadirCaracteristicaAction,
  cambiarDestacadoCaracteristicaAction,
  cambiarVisibleCaracteristicaAction,
  editarValorCaracteristicaAction,
  moverCaracteristicaAction,
  quitarCaracteristicaAction,
} from "./caracteristicas-actions";
import {
  GRUPOS_ATRIBUTO,
  GRUPO_ETIQUETA,
  grupoEfectivo,
  type CaracteristicaEmpresa,
} from "./productos-vista";

/**
 * Editar → Características: la capa de la empresa sobre lo que trajo el
 * catálogo. Lista agrupada (Físicas, Eléctricas, Técnicas, Extra) con, en cada
 * fila, el valor (lápiz para cambiarlo), «Visible», destacar para el PDF,
 * subir / bajar dentro del grupo y quitar (solo las propias).
 */

const SELECT_CLS =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base md:text-sm";

interface AtributoDisponible {
  id: string;
  name: string;
  data_type: string;
  unit: string | null;
}

function valorLegible(c: CaracteristicaEmpresa): string {
  if (c.valorBooleano != null) return c.valorBooleano ? "Sí" : "No";
  if (c.valorNumero != null) {
    const n = formatearNumero(Number(c.valorNumero));
    return c.unidad ? `${n} ${c.unidad}` : n;
  }
  const t = c.valorTexto?.trim();
  if (!t) return "Sin valor";
  return c.unidad && !t.toLowerCase().endsWith(c.unidad.toLowerCase()) ? `${t} ${c.unidad}` : t;
}

function valorEditable(c: CaracteristicaEmpresa): string {
  if (c.valorBooleano != null) return c.valorBooleano ? "Sí" : "No";
  if (c.valorNumero != null) return String(c.valorNumero).replace(".", ",");
  return c.valorTexto ?? "";
}

function EtiquetaOrigen({ c }: { c: CaracteristicaEmpresa }) {
  const txt =
    c.origen === "editado"
      ? "Cambiada por ti"
      : c.origen === "propio" || (!c.heredado && c.origen == null)
        ? "Propia"
        : "Del catálogo";
  return <span className="text-[11px] font-medium text-muted-foreground">{txt}</span>;
}

function Fila({
  productId,
  c,
  primera,
  ultima,
}: {
  productId: string;
  c: CaracteristicaEmpresa;
  primera: boolean;
  ultima: boolean;
}) {
  const [pendiente, start] = useTransition();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valorEditable(c));
  const ask = useConfirm();

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg?: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) notify.error("No se ha podido guardar", r.error);
      else if (okMsg) notify.success(okMsg);
    });
  }

  function guardar() {
    correr(async () => {
      const r = await editarValorCaracteristicaAction(productId, c.valorId, texto.trim() ? texto : null);
      if (r.ok) setEditando(false);
      return r;
    }, "Guardado");
  }

  async function quitar() {
    const ok = await ask({
      message: `¿Quitar «${c.nombre}» de este producto?`,
      confirmText: "Quitar",
      variant: "destructive",
    });
    if (ok) correr(() => quitarCaracteristicaAction(productId, c.valorId), "Quitada");
  }

  return (
    <li className={cn("space-y-2 py-3", !c.visible && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold">{c.nombre}</div>
          {!editando && (
            <div className="break-words text-sm text-muted-foreground">{valorLegible(c)}</div>
          )}
          <EtiquetaOrigen c={c} />
        </div>
        {!editando && (
          <button
            type="button"
            onClick={() => {
              setTexto(valorEditable(c));
              setEditando(true);
            }}
            disabled={pendiente}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card hover:bg-muted"
            aria-label={`Cambiar el valor de ${c.nombre}`}
            title="Cambiar el valor"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>

      {editando && (
        <div className="flex flex-wrap items-center gap-2">
          {c.tipoDato === "boolean" ? (
            <select value={texto} onChange={(e) => setTexto(e.target.value)} className={cn(SELECT_CLS, "w-auto flex-1")}>
              <option value="Sí">Sí</option>
              <option value="No">No</option>
            </select>
          ) : (
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-11 min-w-0 flex-1 text-base md:text-sm"
              aria-label={`Valor de ${c.nombre}`}
              inputMode={c.tipoDato === "number" ? "decimal" : undefined}
              autoFocus
            />
          )}
          {c.unidad && <span className="text-sm text-muted-foreground">{c.unidad}</span>}
          <Button type="button" onClick={guardar} disabled={pendiente} className="h-11">
            <Check className="h-4 w-4" /> Guardar
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditando(false)} disabled={pendiente} className="h-11">
            <X className="h-4 w-4" /> Cancelar
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-11 items-center gap-2 rounded-xl border bg-card px-3 text-sm">
          <Switch
            checked={c.visible}
            disabled={pendiente}
            onCheckedChange={(v) => correr(() => cambiarVisibleCaracteristicaAction(productId, c.valorId, v))}
            aria-label={`Visible: ${c.nombre}`}
          />
          Visible
        </label>
        <button
          type="button"
          onClick={() => correr(() => cambiarDestacadoCaracteristicaAction(productId, c.valorId, !c.destacado))}
          disabled={pendiente}
          aria-pressed={c.destacado}
          title="Destacada en la ficha técnica PDF (máximo 5)"
          className={cn(
            "inline-flex h-11 items-center gap-1.5 rounded-xl border px-3 text-sm",
            c.destacado ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted",
          )}
        >
          <Star className={cn("h-4 w-4", c.destacado && "fill-current")} /> Destacada
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => correr(() => moverCaracteristicaAction(productId, c.valorId, "subir"))}
            disabled={pendiente || primera}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-card hover:bg-muted disabled:opacity-40"
            aria-label={`Subir ${c.nombre}`}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => correr(() => moverCaracteristicaAction(productId, c.valorId, "bajar"))}
            disabled={pendiente || ultima}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-card hover:bg-muted disabled:opacity-40"
            aria-label={`Bajar ${c.nombre}`}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          {!c.heredado && (
            <button
              type="button"
              onClick={quitar}
              disabled={pendiente}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-card text-destructive hover:bg-destructive/10"
              aria-label={`Quitar ${c.nombre}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function FormularioNueva({
  productId,
  disponibles,
  onHecho,
}: {
  productId: string;
  disponibles: AtributoDisponible[];
  onHecho: () => void;
}) {
  const [pendiente, start] = useTransition();
  const [atributoId, setAtributoId] = useState("");
  const [nombre, setNombre] = useState("");
  const [grupo, setGrupo] = useState<string>("tecnicas");
  const [tipo, setTipo] = useState<"text" | "number" | "boolean">("text");
  const [unidad, setUnidad] = useState("");
  const [valor, setValor] = useState("");
  const elegido = disponibles.find((d) => d.id === atributoId) ?? null;
  const tipoEfectivo = elegido ? elegido.data_type : tipo;

  function guardar() {
    start(async () => {
      const r = await anadirCaracteristicaAction(productId, {
        atributoId: atributoId || null,
        nombre,
        grupo,
        tipo,
        unidad,
        valor: tipoEfectivo === "boolean" ? valor || "Sí" : valor,
      });
      if (!r.ok) {
        notify.error("No se ha podido añadir", r.error);
        return;
      }
      notify.success("Característica añadida");
      onHecho();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
      {disponibles.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="car-existente">De las que ya tienes en la empresa</Label>
          <select
            id="car-existente"
            value={atributoId}
            onChange={(e) => setAtributoId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Una nueva</option>
            {disponibles.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.unit ? ` (${d.unit})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {!elegido && (
        <>
          <div className="space-y-1">
            <Label htmlFor="car-nombre">Nombre</Label>
            <Input
              id="car-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Por ejemplo: Garantía de la bomba"
              className="h-11 text-base md:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="car-grupo">Grupo</Label>
              <select id="car-grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)} className={SELECT_CLS}>
                {GRUPOS_ATRIBUTO.map((g) => (
                  <option key={g} value={g}>
                    {GRUPO_ETIQUETA[g]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="car-tipo">Tipo</Label>
              <select
                id="car-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "text" | "number" | "boolean")}
                className={SELECT_CLS}
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="boolean">Sí / No</option>
              </select>
            </div>
            {tipo !== "boolean" && (
              <div className="space-y-1">
                <Label htmlFor="car-unidad">Unidad</Label>
                <Input
                  id="car-unidad"
                  value={unidad}
                  onChange={(e) => setUnidad(e.target.value)}
                  placeholder="mm, W, L…"
                  className="h-11 text-base md:text-sm"
                />
              </div>
            )}
          </div>
        </>
      )}
      <div className="space-y-1">
        <Label htmlFor="car-valor">Valor</Label>
        {tipoEfectivo === "boolean" ? (
          <select id="car-valor" value={valor || "Sí"} onChange={(e) => setValor(e.target.value)} className={SELECT_CLS}>
            <option value="Sí">Sí</option>
            <option value="No">No</option>
          </select>
        ) : (
          <Input
            id="car-valor"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode={tipoEfectivo === "number" ? "decimal" : undefined}
            className="h-11 text-base md:text-sm"
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={guardar} disabled={pendiente} className="h-11">
          <Check className="h-4 w-4" /> Añadir
        </Button>
        <Button type="button" variant="outline" onClick={onHecho} disabled={pendiente} className="h-11">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function CaracteristicasEditor({
  productId,
  caracteristicas,
  disponibles,
  hayOrigen,
}: {
  productId: string;
  caracteristicas: CaracteristicaEmpresa[];
  /** Atributos de la empresa para su categoría que este producto aún no tiene. */
  disponibles: AtributoDisponible[];
  /** La migración de origen está aplicada (si no, «Aplicar actualización» no refresca heredados). */
  hayOrigen: boolean;
}) {
  const [anadiendo, setAnadiendo] = useState(false);
  const grupos = useMemo(
    () =>
      GRUPOS_ATRIBUTO.map((g) => ({
        clave: g,
        lista: caracteristicas.filter((c) => grupoEfectivo(c) === g).sort((a, b) => a.orden - b.orden),
      })).filter((g) => g.lista.length > 0),
    [caracteristicas],
  );
  const ocultas = caracteristicas.filter((c) => !c.visible).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Lo que traiga el catálogo es tu copia: cámbiala, ocúltala u ordénala sin tocar el catálogo.
        {ocultas > 0 && ` ${ocultas === 1 ? "1 oculta" : `${ocultas} ocultas`}: no salen en la ficha.`}
        {!hayOrigen && " Hasta que se aplique la migración de origen, «Aplicar actualización» solo añade lo que falte."}
      </p>

      {grupos.length === 0 && !anadiendo && (
        <p className="text-sm text-muted-foreground">Este producto aún no tiene características.</p>
      )}

      {grupos.map((g) => (
        <section key={g.clave} aria-labelledby={`car-grupo-${g.clave}`}>
          <h3 id={`car-grupo-${g.clave}`} className="text-sm font-bold">
            {GRUPO_ETIQUETA[g.clave]} <span className="font-normal text-muted-foreground">· {g.lista.length}</span>
          </h3>
          <ul className="divide-y">
            {g.lista.map((c, i) => (
              <Fila
                key={c.valorId}
                productId={productId}
                c={c}
                primera={i === 0}
                ultima={i === g.lista.length - 1}
              />
            ))}
          </ul>
        </section>
      ))}

      {anadiendo ? (
        <FormularioNueva productId={productId} disponibles={disponibles} onHecho={() => setAnadiendo(false)} />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAnadiendo(true)} className="h-11 w-full">
          <Plus className="h-4 w-4" /> Añadir característica
        </Button>
      )}
    </div>
  );
}
