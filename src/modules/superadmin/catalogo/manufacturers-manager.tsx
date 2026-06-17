"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ImageUp, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertManufacturerSafeAction,
  deleteManufacturerSafeAction,
  uploadManufacturerLogoAction,
  type ManufacturerItem,
} from "./manufacturers-actions";
import { getCatalogFileUrlAction } from "./master-products-actions";

function LogoImg({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    getCatalogFileUrlAction(path).then((r) => {
      if (!cancelled && r.ok) setUrl(r.url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!path) {
    return (
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Building2 className="h-5 w-5" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url ?? ""} alt="" className="h-12 w-12 rounded-lg object-contain" />;
}

export function ManufacturersManager({ manufacturers }: { manufacturers: ManufacturerItem[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ManufacturerItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoTargetId, setLogoTargetId] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setName("");
    setWebsite("");
    setNotes("");
    setShowForm(true);
  }
  function openEdit(m: ManufacturerItem) {
    setEditing(m);
    setName(m.name);
    setWebsite(m.website ?? "");
    setNotes(m.notes ?? "");
    setShowForm(true);
  }

  function save() {
    if (!name.trim()) {
      notify.warning("El nombre es obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await upsertManufacturerSafeAction({
        id: editing?.id,
        name,
        website,
        notes,
      });
      if (!r.ok) notify.error("Error", r.error);
      else {
        notify.success(editing ? "Fabricante actualizado" : "Fabricante creado");
        setShowForm(false);
        router.refresh();
      }
    });
  }

  async function del(m: ManufacturerItem) {
    const ok = await confirm({
      title: "Borrar fabricante",
      message: `¿Borrar "${m.name}"?`,
      confirmText: "Borrar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteManufacturerSafeAction(m.id);
      if (!r.ok) notify.error("No se pudo borrar", r.error);
      else router.refresh();
    });
  }

  function pickLogo(id: string) {
    setLogoTargetId(id);
    logoInputRef.current?.click();
  }
  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !logoTargetId) return;
    if (file.size > 4 * 1024 * 1024) {
      notify.warning("Logo demasiado grande", "Máximo 4 MB.");
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    const fd = new FormData();
    fd.set("manufacturer_id", logoTargetId);
    fd.set("file", file);
    startTransition(async () => {
      try {
        const r = await uploadManufacturerLogoAction(fd);
        if (!r.ok) notify.error("No se pudo subir el logo", r.error);
        else {
          notify.success("Logo actualizado");
          router.refresh();
        }
      } catch {
        notify.error("No se pudo subir el logo", "Prueba con una imagen más pequeña.");
      }
      if (logoInputRef.current) logoInputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Fabricantes</h2>
        <Button onClick={openNew} disabled={pending}>
          <Plus className="h-4 w-4" /> Nuevo fabricante
        </Button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Web</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Notas</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={pending}>
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button variant="success" onClick={save} disabled={pending}>
              <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      )}

      <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={onLogoFile} />

      {manufacturers.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No hay fabricantes. Crea el primero.
        </div>
      ) : (
        <div className="space-y-2">
          {manufacturers.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <LogoImg path={m.logo_path} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{m.name}</span>
                  {!m.is_active && (
                    <span className="rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
                      Inactivo
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.product_count} producto{m.product_count === 1 ? "" : "s"}
                  {m.website ? ` · ${m.website}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => pickLogo(m.id)}
                disabled={pending}
                title="Subir logo"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                <ImageUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => openEdit(m)}
                disabled={pending}
                title="Editar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => del(m)}
                disabled={pending}
                title="Borrar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-100 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
