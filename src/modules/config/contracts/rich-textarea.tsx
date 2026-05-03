"use client";

import { useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Eye, EyeOff } from "lucide-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  id?: string;
  required?: boolean;
}

/**
 * Textarea con toolbar para insertar marcadores Markdown ligero
 * (negrita **t**, cursiva *t*, lista - / 1.) y vista previa simple.
 * No depende de librería externa: el preview hace un parse mínimo de los
 * marcadores que la toolbar genera. La cláusula se sigue almacenando como
 * texto plano y el PDF la renderiza con la lógica que ya tiene.
 */
export function RichTextarea({ value, onChange, rows = 8, id, required }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);

  function wrap(prefix: string, suffix = prefix) {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end) || "texto";
    const next = value.slice(0, start) + prefix + sel + suffix + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + prefix.length;
      ta.setSelectionRange(pos, pos + sel.length);
    });
  }

  function prefixLines(prefix: string) {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = value.slice(0, start);
    const sel = value.slice(start, end);
    const after = value.slice(end);
    const lines = (sel || "Elemento").split("\n");
    const transformed =
      prefix === "1. "
        ? lines.map((l, i) => `${i + 1}. ${l}`).join("\n")
        : lines.map((l) => `${prefix}${l}`).join("\n");
    onChange(before + transformed + after);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-t-xl border border-border bg-muted/40 p-1.5">
        <ToolbarBtn onClick={() => wrap("**")} label="Negrita">
          <Bold className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => wrap("_")} label="Cursiva">
          <Italic className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => prefixLines("- ")} label="Lista">
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => prefixLines("1. ")} label="Lista numerada">
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarBtn onClick={() => setPreview((p) => !p)} label="Previsualizar">
          {preview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span className="ml-1 text-xs">{preview ? "Editar" : "Vista previa"}</span>
        </ToolbarBtn>
      </div>
      {preview ? (
        <div
          className="min-h-40 rounded-b-xl border border-t-0 border-border bg-card p-3 text-sm leading-relaxed prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      ) : (
        <textarea
          id={id}
          ref={ref}
          required={required}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-b-xl border border-t-0 border-border bg-card p-3 text-sm font-mono"
        />
      )}
      <p className="text-xs text-muted-foreground">
        Sintaxis: <code>**negrita**</code>, <code>_cursiva_</code>, <code>- lista</code>,{" "}
        <code>1. lista</code>. Una línea en blanco crea párrafo nuevo.
      </p>
    </div>
  );
}

function ToolbarBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center rounded-md px-2 py-1 text-foreground hover:bg-background"
    >
      {children}
    </button>
  );
}

/** Render mínimo de markdown que cubre lo que produce la toolbar. */
function renderMarkdown(src: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>");

  const blocks = src.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*-\s+/.test(l))) {
        return (
          "<ul>" +
          lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ""))}</li>`).join("") +
          "</ul>"
        );
      }
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        return (
          "<ol>" +
          lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("") +
          "</ol>"
        );
      }
      return `<p>${inline(block).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
}
