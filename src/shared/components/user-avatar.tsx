/**
 * Avatar circular con iniciales y color determinístico desde el user_id.
 * No requiere imagen subida — siempre muestra algo coherente.
 */

const COLORS = [
  "bg-primary text-primary-foreground",
  "bg-success text-success-foreground",
  "bg-warning text-warning-foreground",
  "bg-destructive text-destructive-foreground",
  "bg-secondary text-secondary-foreground",
  "bg-[#9333ea] text-white",
  "bg-[#0891b2] text-white",
  "bg-[#65a30d] text-white",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function initials(name: string | null | undefined): string {
  const src = (name ?? "?").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

export function UserAvatar({
  userId,
  name,
  size = "md",
  src,
}: {
  userId: string;
  name: string | null;
  size?: "sm" | "md" | "lg";
  /** URL pública del avatar (si existe). Si null/undefined, fallback a iniciales. */
  src?: string | null;
}) {
  const cls = COLORS[hashStr(userId) % COLORS.length]!;
  const dim =
    size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-14 w-14 text-base" : "h-10 w-10 text-sm";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ""}
        className={`shrink-0 rounded-full object-cover ${dim}`}
        title={name ?? ""}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${cls} ${dim}`}
      title={name ?? ""}
    >
      {initials(name)}
    </div>
  );
}
