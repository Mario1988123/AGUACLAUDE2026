"use client";

import { useEffect, useState } from "react";
import { Input } from "@/shared/ui/input";

/**
 * Input para importes en euros. Internamente trabaja con céntimos (number)
 * pero el usuario teclea libre con coma o punto. NO se reformatea mientras
 * escribe (problema típico: tecleas "8" y se autocompleta a "8,00" y ya no
 * puedes seguir escribiendo). Sólo se reformatea al perder el foco.
 */
export function MoneyInput({
  valueCents,
  onChangeCents,
  className,
  disabled,
  placeholder,
  id,
  name,
}: {
  valueCents: number | null;
  onChangeCents: (cents: number) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
}) {
  const [text, setText] = useState(() => formatForEdit(valueCents));
  const [focused, setFocused] = useState(false);

  // Re-sincroniza si el padre cambia el valor desde fuera (y no estamos editando)
  useEffect(() => {
    if (!focused) setText(formatForEdit(valueCents));
  }, [valueCents, focused]);

  function commit(raw: string) {
    const cents = parseToCents(raw);
    if (cents != null) {
      onChangeCents(cents);
      setText(formatForEdit(cents));
    } else {
      // No parseable → vuelve al último valor válido
      setText(formatForEdit(valueCents));
    }
  }

  return (
    <Input
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? "0,00"}
      disabled={disabled}
      className={className}
      autoComplete="off"
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function formatForEdit(cents: number | null): string {
  if (cents == null) return "";
  // Mostramos con coma decimal (es-ES) y siempre 2 decimales
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Texto que teclea el usuario → céntimos. Exportada para los tests.
 *
 * I41: antes se quitaban TODOS los puntos ("." como separador de miles) y
 * "49.90" se convertía en 4.990,00 €. Reglas ahora (es-ES, pero aceptando
 * el punto decimal que mete el teclado numérico del móvil):
 *  · Si hay coma y punto, el que va DETRÁS es el decimal
 *    ("1.234,56" y "1,234.56" → 1234,56).
 *  · Solo coma → decimal ("49,90"). Varias comas → inválido.
 *  · Solo punto(s): si todos los grupos tras el primero tienen exactamente
 *    3 cifras es separador de miles ("1.234" → 1234, "1.234.567"); si no,
 *    un único punto es el decimal ("49.90", "49.9").
 *  · Más de 2 decimales → inválido (vuelve al valor anterior en vez de
 *    redondear a escondidas). Negativos → inválido.
 * Sin coma flotante: se trabaja con las cifras como texto.
 */
export function parseToCents(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!clean) return 0;
  if (!/^[0-9.,]+$/.test(clean)) return null;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let entero: string;
  let decimales = "";
  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? "," : ".";
    const milSep = decSep === "," ? "." : ",";
    const idx = clean.lastIndexOf(decSep);
    entero = clean.slice(0, idx);
    decimales = clean.slice(idx + 1);
    if (entero.includes(decSep)) return null;
    if (!milesValidos(entero, milSep)) return null;
    entero = entero.split(milSep).join("");
  } else if (lastComma >= 0) {
    const partes = clean.split(",");
    if (partes.length !== 2) return null;
    entero = partes[0]!;
    decimales = partes[1]!;
  } else if (lastDot >= 0) {
    const partes = clean.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1]!.length === 3 && /^[1-9]/.test(partes[0]!))) {
      // Separador de miles
      if (!milesValidos(clean, ".")) return null;
      entero = partes.join("");
    } else {
      entero = partes[0]!;
      decimales = partes[1] ?? "";
    }
  } else {
    entero = clean;
  }
  if (entero === "") entero = "0";
  if (!/^\d+$/.test(entero) || !/^\d{0,2}$/.test(decimales)) return null;
  const cents = Number(entero) * 100 + Number((decimales + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** "1.234.567" con separador `sep`: primer grupo 1-3 cifras, resto de 3. */
function milesValidos(texto: string, sep: string): boolean {
  if (!texto.includes(sep)) return /^\d*$/.test(texto);
  const grupos = texto.split(sep);
  if (!/^\d{1,3}$/.test(grupos[0]!)) return false;
  return grupos.slice(1).every((g) => /^\d{3}$/.test(g));
}
