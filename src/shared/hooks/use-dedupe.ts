"use client";

import { useEffect, useState } from "react";
import { checkDedupe } from "@/shared/lib/dedupe/check-dedupe";
import type { DedupeMatch } from "@/shared/lib/dedupe/check-dedupe";

interface Args {
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  exclude?: { entity: "lead" | "customer"; id: string };
  /** ms debounce */
  debounceMs?: number;
}

/**
 * Lanza checkDedupe en background con debounce de 600ms cada vez que cambia
 * cualquiera de los campos. Devuelve los matches actuales (vacío si nada).
 */
export function useDedupe(args: Args): DedupeMatch[] {
  const [matches, setMatches] = useState<DedupeMatch[]>([]);
  const debounceMs = args.debounceMs ?? 600;
  const tax = args.tax_id?.trim() || "";
  const email = args.email?.trim() || "";
  const phone = args.phone?.trim() || "";

  useEffect(() => {
    if (!tax && !email && !phone) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkDedupe({
        tax_id: tax || undefined,
        email: email || undefined,
        phone: phone || undefined,
        exclude: args.exclude,
      })
        .then((res) => {
          if (!cancelled) setMatches(res);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tax, email, phone, debounceMs, args.exclude?.entity, args.exclude?.id]);

  return matches;
}
