import { describe, it, expect } from "vitest";
import { authErrorEs, MIN_PASSWORD_LENGTH } from "./auth-error-es";

describe("authErrorEs", () => {
  it("traduce el caso real registrado en superadmin (2026-08-17)", () => {
    expect(authErrorEs("Password should be at least 6 characters.")).toBe(
      "La contraseña debe tener al menos 6 caracteres.",
    );
  });

  it("respeta la longitud que diga el servidor, no la hardcodea", () => {
    expect(authErrorEs("Password should be at least 10 characters")).toContain("10");
  });

  it("traduce credenciales inválidas con y sin punto final", () => {
    expect(authErrorEs("Invalid login credentials")).toBe(
      "Email o contraseña incorrectos.",
    );
    expect(authErrorEs("invalid login credentials.")).toBe(
      "Email o contraseña incorrectos.",
    );
  });

  it("traduce la espera por seguridad con sus segundos", () => {
    expect(
      authErrorEs("For security purposes, you can only request this after 47 seconds"),
    ).toBe("Por seguridad, espera 47 segundos antes de volver a intentarlo.");
  });

  it("devuelve el original si no lo reconoce (mejor inglés que un genérico)", () => {
    expect(authErrorEs("Some brand new supabase error")).toBe(
      "Some brand new supabase error",
    );
  });

  it("nunca devuelve cadena vacía", () => {
    expect(authErrorEs("")).not.toBe("");
    expect(authErrorEs(null)).not.toBe("");
    expect(authErrorEs(undefined).length).toBeGreaterThan(10);
  });

  it("MIN_PASSWORD_LENGTH coincide con el default de Supabase", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });
});
