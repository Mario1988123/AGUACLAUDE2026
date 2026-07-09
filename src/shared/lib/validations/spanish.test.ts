import { describe, it, expect } from "vitest";
import {
  validateDNI,
  validateNIE,
  validateDNIorNIE,
  validateCIF,
  validateIBAN,
  isPlaceholderTaxId,
  validateSpanishPostalCode,
  validateSpanishPhone,
  normalizeSpanishPhone,
  provinceFromPostalCode,
  normalizeProvinceName,
  provincesMatch,
} from "./spanish";

describe("validateDNI", () => {
  it("acepta un DNI con letra de control correcta (12345678 → Z)", () => {
    expect(validateDNI("12345678Z")).toEqual({ valid: true, expectedLetter: "Z" });
  });
  it("normaliza minúsculas/espacios/guiones", () => {
    expect(validateDNI(" 12345678-z ").valid).toBe(true);
  });
  it("rechaza letra incorrecta y devuelve la esperada", () => {
    expect(validateDNI("00000000A")).toEqual({ valid: false, expectedLetter: "T" });
  });
  it("el DNI comodín 12345678A se admite como válido (venta al contado)", () => {
    expect(validateDNI("12345678A")).toEqual({ valid: true });
  });
  it("rechaza formato inválido", () => {
    expect(validateDNI("1234567Z").valid).toBe(false); // 7 dígitos
    expect(validateDNI("ABCDEFGHZ").valid).toBe(false);
  });
});

describe("validateNIE", () => {
  it("acepta NIE válidos (X1234567L, Y6403420G)", () => {
    expect(validateNIE("X1234567L").valid).toBe(true);
    expect(validateNIE("Y6403420G").valid).toBe(true);
  });
  it("rechaza letra de control incorrecta", () => {
    expect(validateNIE("X1234567A")).toEqual({ valid: false, expectedLetter: "L" });
  });
  it("rechaza si no empieza por X/Y/Z", () => {
    expect(validateNIE("A1234567L").valid).toBe(false);
  });
});

describe("validateDNIorNIE", () => {
  it("enruta a NIE si empieza por X/Y/Z, a DNI en otro caso", () => {
    expect(validateDNIorNIE("X1234567L").valid).toBe(true);
    expect(validateDNIorNIE("12345678Z").valid).toBe(true);
    expect(validateDNIorNIE("12345678A").valid).toBe(true); // comodín
  });
});

describe("validateCIF (solo formato)", () => {
  it("acepta letras de organización válidas", () => {
    expect(validateCIF("B12345678")).toBe(true);
    expect(validateCIF("A1234567B")).toBe(true);
  });
  it("rechaza letra inicial no permitida o longitud incorrecta", () => {
    expect(validateCIF("I1234567B")).toBe(false); // I no es válida
    expect(validateCIF("B123456")).toBe(false); // corto
  });
});

describe("validateIBAN (mod 97)", () => {
  it("acepta IBAN válidos (ES y otros países)", () => {
    expect(validateIBAN("ES9121000418450200051332")).toBe(true);
    expect(validateIBAN("GB82WEST12345698765432")).toBe(true);
  });
  it("acepta con espacios y minúsculas", () => {
    expect(validateIBAN("es91 2100 0418 4502 0005 1332")).toBe(true);
  });
  it("rechaza un IBAN con dígito de control corrupto", () => {
    expect(validateIBAN("ES9121000418450200051333")).toBe(false);
  });
  it("rechaza formato inválido", () => {
    expect(validateIBAN("1234")).toBe(false);
    expect(validateIBAN("ES1")).toBe(false);
  });
});

describe("isPlaceholderTaxId", () => {
  it("reconoce el comodín en cualquier grafía", () => {
    expect(isPlaceholderTaxId("12345678A")).toBe(true);
    expect(isPlaceholderTaxId(" 12345678-a ")).toBe(true);
  });
  it("no confunde un DNI real con el comodín", () => {
    expect(isPlaceholderTaxId("12345678Z")).toBe(false);
    expect(isPlaceholderTaxId(null)).toBe(false);
  });
});

describe("validateSpanishPostalCode", () => {
  it("acepta CP de provincias 01-52", () => {
    expect(validateSpanishPostalCode("28001")).toBe(true);
    expect(validateSpanishPostalCode("52001")).toBe(true);
  });
  it("rechaza provincia fuera de rango o longitud incorrecta", () => {
    expect(validateSpanishPostalCode("00123")).toBe(false); // provincia 00
    expect(validateSpanishPostalCode("53001")).toBe(false); // provincia 53
    expect(validateSpanishPostalCode("2800")).toBe(false); // 4 dígitos
  });
});

describe("validateSpanishPhone / normalizeSpanishPhone", () => {
  it("acepta móvil y fijo, con o sin prefijo", () => {
    expect(validateSpanishPhone("612345678")).toBe(true);
    expect(validateSpanishPhone("912345678")).toBe(true);
    expect(validateSpanishPhone("+34612345678")).toBe(true);
    expect(validateSpanishPhone("0034612345678")).toBe(true);
  });
  it("rechaza prefijo de red no válido o longitud incorrecta", () => {
    expect(validateSpanishPhone("512345678")).toBe(false); // empieza por 5
    expect(validateSpanishPhone("61234567")).toBe(false); // 8 dígitos
  });
  it("normaliza a +34XXXXXXXXX (o null si inválido)", () => {
    expect(normalizeSpanishPhone("612 345 678")).toBe("+34612345678");
    expect(normalizeSpanishPhone("nope")).toBeNull();
  });
});

describe("provinceFromPostalCode", () => {
  it("mapea los dos primeros dígitos a la provincia", () => {
    expect(provinceFromPostalCode("28001")).toBe("Madrid");
    expect(provinceFromPostalCode("48001")).toBe("Vizcaya");
    expect(provinceFromPostalCode("07800")).toBe("Islas Baleares");
  });
  it("CP inválido => null", () => {
    expect(provinceFromPostalCode("99999")).toBeNull();
  });
});

describe("normalizeProvinceName / provincesMatch (alias cooficiales)", () => {
  it("resuelve variantes cooficiales al mismo canónico", () => {
    expect(provincesMatch("Vizcaya", "Bizkaia")).toBe(true);
    expect(provincesMatch("A Coruña", "La Coruña")).toBe(true);
    expect(provincesMatch("Girona", "Gerona")).toBe(true);
  });
  it("quita prefijos ('Provincia de…')", () => {
    expect(provincesMatch("Provincia de Madrid", "Madrid")).toBe(true);
    expect(normalizeProvinceName("Provincia de Madrid")).toBe("madrid");
  });
  it("provincias distintas no casan", () => {
    expect(provincesMatch("Madrid", "Barcelona")).toBe(false);
  });
  it("si alguno está vacío, no se puede afirmar contradicción => true", () => {
    expect(provincesMatch(null, "Madrid")).toBe(true);
    expect(provincesMatch("Madrid", "")).toBe(true);
  });
});
