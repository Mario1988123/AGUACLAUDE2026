import { describe, expect, it } from "vitest";
import { toCsv } from "./to-csv";

const fila = (v: string | number) => toCsv(["c"], [[v]]).split("\n")[1];

describe("toCsv — protección contra fórmulas", () => {
  it("neutraliza textos que Excel ejecutaría como fórmula", () => {
    expect(fila("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(fila("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(fila("+34 600 000 000")).toBe("'+34 600 000 000");
    expect(fila("-cmd")).toBe("'-cmd");
  });

  it("deja los importes como números, también los negativos en texto", () => {
    expect(fila("-12,50")).toBe(`"-12,50"`);
    expect(fila("12.5")).toBe("12.5");
    expect(fila(-3)).toBe("-3");
  });

  it("no toca textos normales", () => {
    expect(fila("Juan Pérez")).toBe("Juan Pérez");
  });
});
