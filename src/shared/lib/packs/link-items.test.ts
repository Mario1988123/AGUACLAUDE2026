import { describe, it, expect } from "vitest";
import { linkItemsByParentIndex, relinkCopiedItems } from "./link-items";

/**
 * Cliente Supabase FALSO: registra cada `.from(t).update(p).eq().eq()` como una
 * llamada { table, payload, eqs }. Sin BD — solo verifica la LÓGICA de mapeo
 * padre-hijo (qué UPDATE se emite y sobre qué id), que es el núcleo de packs.
 */
interface RecordedCall {
  table: string;
  payload: Record<string, unknown>;
  eqs: Record<string, unknown>;
}
function makeFakeClient() {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const call: RecordedCall = { table, payload, eqs: {} };
          const chain = {
            eq(col: string, val: unknown) {
              call.eqs[col] = val;
              return chain;
            },
            // thenable: al await se resuelve a { error: null } y registra la call
            then(resolve: (v: { error: null }) => unknown) {
              calls.push(call);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

describe("linkItemsByParentIndex", () => {
  it("enlaza cada extra a su principal por índice, filtrando company_id", async () => {
    const { client, calls } = makeFakeClient();
    const inserted = [
      { id: "A", display_order: 0 }, // principal
      { id: "B", display_order: 1 }, // extra de A
      { id: "C", display_order: 2 }, // extra de A
    ];
    // order0 = principal (null); order1 y order2 cuelgan del índice 0
    const parentIndexByOrder = [null, 0, 0];

    await linkItemsByParentIndex(client, "proposal_items", "co1", inserted, parentIndexByOrder);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      table: "proposal_items",
      payload: { parent_item_id: "A" },
      eqs: { id: "B", company_id: "co1" },
    });
    expect(calls[1]).toEqual({
      table: "proposal_items",
      payload: { parent_item_id: "A" },
      eqs: { id: "C", company_id: "co1" },
    });
  });

  it("no emite UPDATE para líneas principales (parent null) ni auto-referencias", async () => {
    const { client, calls } = makeFakeClient();
    const inserted = [{ id: "A", display_order: 0 }];
    // un solo item, marcado como hijo de sí mismo (índice 0) => se ignora
    await linkItemsByParentIndex(client, "proposal_items", "co1", inserted, [0]);
    expect(calls).toHaveLength(0);
  });

  it("tolera inserted null/vacío sin lanzar", async () => {
    const { client, calls } = makeFakeClient();
    await linkItemsByParentIndex(client, "proposal_items", "co1", null, [null]);
    expect(calls).toHaveLength(0);
  });
});

describe("relinkCopiedItems", () => {
  it("reconstruye el vínculo por display_order al copiar de un nivel al siguiente", async () => {
    const { client, calls } = makeFakeClient();
    // destino recién insertado (contract_items)
    const inserted = [
      { id: "X", display_order: 0 },
      { id: "Y", display_order: 1 },
    ];
    // origen (proposal_items): la línea de order1 era extra de la de order0
    const sourceRows = [
      { id: "srcA", display_order: 0, parent_item_id: null },
      { id: "srcB", display_order: 1, parent_item_id: "srcA" },
    ];

    await relinkCopiedItems(client, "contract_items", "co1", inserted, sourceRows);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      table: "contract_items",
      payload: { parent_item_id: "X" }, // el principal destino (mismo display_order que srcA)
      eqs: { id: "Y", company_id: "co1" },
    });
  });

  it("sin padres en el origen no emite ningún UPDATE", async () => {
    const { client, calls } = makeFakeClient();
    const inserted = [{ id: "X", display_order: 0 }];
    const sourceRows = [{ id: "srcA", display_order: 0, parent_item_id: null }];
    await relinkCopiedItems(client, "contract_items", "co1", inserted, sourceRows);
    expect(calls).toHaveLength(0);
  });
});
