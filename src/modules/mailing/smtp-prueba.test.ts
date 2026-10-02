import { describe, expect, it } from "vitest";
import { MARCADOR_PASSWORD, resolverConfigPrueba } from "./smtp-prueba";
import { decodeUrlSafe, destinoClicPermitido, wrapWithTracking } from "./tracking";

const guardada = {
  host: "smtp.empresa.es",
  port: 587,
  user: "empleado@empresa.es",
  secure: true,
  tienePassword: true,
};
const base = {
  smtp_host: "smtp.empresa.es",
  smtp_port: 587,
  smtp_user: "empleado@empresa.es",
  smtp_secure: true,
};

describe("resolverConfigPrueba (I14)", () => {
  it("con contraseña nueva usa lo que llega del formulario", () => {
    const r = resolverConfigPrueba(
      { ...base, smtp_host: "otro.es", smtp_password: "nueva" },
      guardada,
    );
    expect(r).toMatchObject({
      ok: true,
      usarGuardada: false,
      config: { host: "otro.es", password: "nueva" },
    });
  });
  it("sin contraseña y mismo servidor usa la guardada con los datos GUARDADOS", () => {
    const r = resolverConfigPrueba(
      { ...base, smtp_host: " SMTP.empresa.es ", smtp_password: MARCADOR_PASSWORD },
      guardada,
    );
    expect(r).toMatchObject({ ok: true, usarGuardada: true, config: { host: "smtp.empresa.es" } });
  });
  it("NO entrega la contraseña guardada a otro host, usuario, puerto o cifrado", () => {
    for (const cambio of [
      { smtp_host: "atacante.example" },
      { smtp_user: "otro@empresa.es" },
      { smtp_port: 2525 },
      { smtp_secure: false },
    ]) {
      expect(resolverConfigPrueba({ ...base, ...cambio }, guardada).ok).toBe(false);
    }
  });
  it("sin contraseña ni guardada → error", () => {
    expect(resolverConfigPrueba(base, null).ok).toBe(false);
    expect(resolverConfigPrueba(base, { ...guardada, tienePassword: false }).ok).toBe(false);
  });
});

const html =
  '<p>Hola</p><a class="b" href="https://empresa.es/oferta?a=1&b=2">Ver</a>' +
  "<a href='http://x.es/'>x</a>";

describe("destinoClicPermitido (I20)", () => {
  it("acepta un destino que está como enlace en el correo", () => {
    expect(destinoClicPermitido("https://empresa.es/oferta?a=1&b=2", html)).toBe(true);
    expect(destinoClicPermitido("http://x.es/", html)).toBe(true);
  });
  it("rechaza destinos que no están en el correo (open redirect)", () => {
    expect(destinoClicPermitido("https://example.com", html)).toBe(false);
    expect(destinoClicPermitido("https://empresa.es/oferta", html)).toBe(false);
  });
  it("rechaza si no hay HTML o destino", () => {
    expect(destinoClicPermitido("https://empresa.es", null)).toBe(false);
    expect(destinoClicPermitido(null, html)).toBe(false);
  });
  it("cuadra con la reescritura de wrapWithTracking (ida y vuelta)", () => {
    const envuelto = wrapWithTracking(html, "abc", "https://crm.test");
    const enlaces = Array.from(envuelto.matchAll(/api\/track\/click\/abc\?u=([^"']+)/g));
    expect(enlaces.length).toBe(2);
    for (const m of enlaces) {
      expect(destinoClicPermitido(decodeUrlSafe(m[1]!), html)).toBe(true);
    }
  });
  it("decodeUrlSafe rechaza esquemas no http(s)", () => {
    expect(decodeUrlSafe(Buffer.from("javascript:alert(1)").toString("base64url"))).toBeNull();
  });
});
