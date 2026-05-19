"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface Photo {
  id: string;
  category: string;
  signed_url: string | null;
}

const LABEL: Record<string, string> = {
  equipment: "Equipo",
  connection: "Conexión",
  damage: "Daño",
  extra: "Otra",
};

function labelFor(cat: string): string {
  return LABEL[cat] ?? cat;
}

export function PhotoGallery({ photos }: { photos: Photo[] }) {
  const [active, setActive] = useState<Photo | null>(null);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => p.signed_url && setActive(p)}
            className="relative aspect-square overflow-hidden rounded-lg border transition hover:ring-2 hover:ring-primary"
            aria-label="Ampliar foto"
          >
            {p.signed_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.signed_url}
                alt={labelFor(p.category)}
                className="h-full w-full object-cover"
              />
            )}
            <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
              {labelFor(p.category)}
            </span>
          </button>
        ))}
      </div>

      {active && active.signed_url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-label="Foto ampliada"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActive(null);
            }}
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black hover:bg-white"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="absolute left-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-bold text-black">
            {labelFor(active.category)}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.signed_url}
            alt={labelFor(active.category)}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
