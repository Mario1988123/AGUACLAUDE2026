/**
 * Genera contraseña temporal segura (16 chars con mayús/minús/dígitos/
 * símbolos, asegurando al menos uno de cada). Compartida entre
 * superadmin (crear admin de empresa) y company admin (invitar
 * comerciales/instaladores) para que el flujo sea uniforme.
 *
 * Caracteres ambiguos excluidos (I/O/1/0/l) para que no se confundan
 * al copiarla.
 */
export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const len = 16;
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];
  for (let i = pwd.length; i < len; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}
