import { describe, it, expect } from "vitest";
import { isBlockingDuplicate } from "./rules";
import type { DedupeMatch } from "./check-dedupe";

function match(
  field: DedupeMatch["field"],
  party_kind: DedupeMatch["party_kind"],
): DedupeMatch {
  return {
    field,
    entity: "customer",
    party_kind,
    id: "1",
    display_name: "X",
    assigned_user_id: null,
    assigned_user_name: null,
  };
}

describe("isBlockingDuplicate", () => {
  it("el DNI/CIF repetido bloquea siempre, aunque cambie el tipo de titular", () => {
    expect(isBlockingDuplicate(match("tax_id", "individual"), "company")).toBe(true);
    expect(isBlockingDuplicate(match("tax_id", "company"), "individual")).toBe(true);
  });

  it("email/teléfono repetidos bloquean si es el mismo tipo de titular", () => {
    expect(isBlockingDuplicate(match("email", "individual"), "individual")).toBe(true);
    expect(isBlockingDuplicate(match("phone", "company"), "company")).toBe(true);
  });

  it("la particular que se da de alta como empresa (o al revés) NO se bloquea", () => {
    expect(isBlockingDuplicate(match("email", "individual"), "company")).toBe(false);
    expect(isBlockingDuplicate(match("phone", "individual"), "company")).toBe(false);
    expect(isBlockingDuplicate(match("phone", "company"), "individual")).toBe(false);
  });

  it("sin saber el tipo de titular, se bloquea igual que antes", () => {
    expect(isBlockingDuplicate(match("email", "individual"), null)).toBe(true);
  });
});
