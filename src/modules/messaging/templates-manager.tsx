"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertMessageTemplateAction,
  deleteMessageTemplateAction,
  type MessageTemplateRow,
} from "./actions";

export function MessageTemplatesManager({ items }: { items: MessageTemplateRow[] }) {
  const [editing, setEditing] = useState<MessageTemplateRow | "new" | null>(null);

  if (editing) {
    const initial = editing === "new" ? null : editing;
    return <TemplateForm initial={initial} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Variables disponibles: <code>{"{nombre}"}</code> <code>{"{empresa}"}</code>{" "}
        <code>{"{comercial}"}</code> <code>{"{ref}"}</code> <code>{"{fecha}"}</code>.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin plantillas.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <TemplateRow key={t.id} item={t} onEdit={() => setEditing(t)} />
          ))}
        </ul>
      )}
      <Button onClick={() => setEditing("new")} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> Nueva plantilla
      </Button>
    </div>
  );
}

function TemplateRow({
  item,
  onEdit,
}: {
  item: MessageTemplateRow;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function remove() {
    const ok = await ask({
      message: `¿Eliminar plantilla "${item.label}"?`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteMessageTemplateAction(item.id);
        notify.success("Eliminada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">#{item.sort_order}</Badge>
          <span className="font-semibold">{item.label}</span>
          <Badge variant="secondary">{item.channel}</Badge>
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{item.key}</code>
        </div>
        {item.subject && (
          <div className="mt-1 text-xs">
            <strong>Asunto:</strong> {item.subject}
          </div>
        )}
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
          {item.body}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}

function TemplateForm({
  initial,
  onDone,
}: {
  initial: MessageTemplateRow | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    label: initial?.label ?? "",
    channel: initial?.channel ?? ("any" as "whatsapp" | "email" | "any"),
    subject: initial?.subject ?? "",
    body: initial?.body ?? "",
    sort_order: initial?.sort_order ?? 0,
  });

  function save() {
    if (!form.key.trim() || !form.label.trim() || !form.body.trim()) {
      notify.warning("Key, etiqueta y cuerpo obligatorios");
      return;
    }
    startTransition(async () => {
      try {
        await upsertMessageTemplateAction({
          id: initial?.id,
          key: form.key,
          label: form.label,
          channel: form.channel,
          subject: form.subject || undefined,
          body: form.body,
          sort_order: form.sort_order,
        });
        notify.success("Guardada");
        onDone();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Key (interna)</Label>
            <Input
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              disabled={!!initial}
              placeholder="recordatorio_cita"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Etiqueta</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Canal</Label>
            <select
              value={form.channel}
              onChange={(e) =>
                setForm({ ...form, channel: e.target.value as "whatsapp" | "email" | "any" })
              }
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
            >
              <option value="any">Cualquiera</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Orden</Label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Asunto (solo email)</Label>
          <Input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cuerpo</Label>
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={8}
            className="w-full rounded-xl border border-input bg-background p-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Variables: <code>{"{nombre}"}</code> <code>{"{empresa}"}</code>{" "}
            <code>{"{comercial}"}</code> <code>{"{ref}"}</code> <code>{"{fecha}"}</code>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onDone} disabled={pending}>
            <X className="h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={save} disabled={pending} variant="success">
            <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
