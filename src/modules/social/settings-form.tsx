"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { upsertSocialSettings, type SocialSettings } from "./settings-actions";

interface Props {
  initial: SocialSettings;
}

export function SocialSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    brand_name: initial.brand_name ?? "",
    brand_hashtag: initial.brand_hashtag ?? "",
    base_hashtags_text: (initial.base_hashtags ?? []).join(" "),
    autonomous_mode: initial.autonomous_mode,
    brand_voice: initial.brand_voice ?? "",
    visual_style: initial.visual_style ?? "",
  });

  function save() {
    if (!form.brand_name.trim()) {
      notify.warning("El nombre de marca es obligatorio");
      return;
    }
    const tags = form.base_hashtags_text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    startTransition(async () => {
      const r = await upsertSocialSettings({
        brand_name: form.brand_name.trim(),
        brand_hashtag: form.brand_hashtag.trim() || null,
        base_hashtags: tags,
        autonomous_mode: form.autonomous_mode,
        brand_voice: form.brand_voice.trim() || null,
        visual_style: form.visual_style.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Configuración guardada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nombre de marca</Label>
          <Input
            value={form.brand_name}
            onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
            placeholder="ej: Aguas del Sur"
          />
          <p className="text-[11px] text-muted-foreground">
            Sustituye <code>{"{{brand_name}}"}</code> en los copys generados.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Hashtag principal</Label>
          <Input
            value={form.brand_hashtag}
            onChange={(e) => setForm({ ...form, brand_hashtag: e.target.value })}
            placeholder="#AguasDelSur"
          />
          <p className="text-[11px] text-muted-foreground">
            Aparece en todas las publicaciones generadas.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Hashtags base (separados por espacio)</Label>
        <Input
          value={form.base_hashtags_text}
          onChange={(e) =>
            setForm({ ...form, base_hashtags_text: e.target.value })
          }
          placeholder="#TratamientoDelAgua #AguaPotable #Descalcificador"
        />
        <p className="text-[11px] text-muted-foreground">
          Hashtags que se añaden a todas las publicaciones. Si olvidas el #,
          se añade automáticamente.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Voz de marca</Label>
        <textarea
          value={form.brand_voice}
          onChange={(e) => setForm({ ...form, brand_voice: e.target.value })}
          rows={2}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          placeholder="Ej: profesional, claro, cercano, sin tecnicismos innecesarios"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Estilo visual</Label>
        <textarea
          value={form.visual_style}
          onChange={(e) => setForm({ ...form, visual_style: e.target.value })}
          rows={2}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          placeholder="Ej: limpio, azul agua, blanco, tonos naturales, sin personas reconocibles"
        />
      </div>

      <div className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.autonomous_mode}
            onChange={(e) =>
              setForm({ ...form, autonomous_mode: e.target.checked })
            }
            className="mt-0.5 h-4 w-4"
          />
          <div>
            <div className="text-sm font-bold">Modo autónomo</div>
            <div className="text-xs text-muted-foreground">
              El día 25 de cada mes, el cron genera automáticamente los
              borradores del mes siguiente. Tú solo revisas y apruebas.
            </div>
          </div>
        </label>
      </div>

      <div className="flex justify-end border-t pt-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
