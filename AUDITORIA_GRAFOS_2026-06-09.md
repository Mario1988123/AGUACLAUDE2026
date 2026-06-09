# Auditoría de conexiones (grafo del código) — 2026-06-09

> Generada con graphify sobre `src/` (865 archivos, 4.729 nodos, 15.082 aristas, 198 grupos).
> **Solo análisis. No se ha tocado ni una línea de código.** Base: `graphify-out/graph.json`
> (commit `2af47cb`). El 96% de las conexiones son EXTRAÍDAS (fiables); 4% inferidas.

## Qué busca esta auditoría
"Fallos de conexión" = dependencias circulares (archivos/módulos que se importan en círculo,
como `points/award ↔ milestones`) y violaciones de capas (algo genérico que depende de algo
concreto). Esos son los que generan bugs raros, builds frágiles y dificultad para mover código.

---

## 🔴 Violaciones de capa (lo más importante)
Lo "compartido/genérico" NO debería depender de un módulo concreto. Aquí pasa:

1. **`shared/components/header.tsx` → `modules/time-tracking/time-clock-widget.tsx`**
   El header (componente compartido por toda la app) importa directamente un widget del módulo
   de fichaje. Resultado: `shared/components` y `time-tracking` se importan mutuamente.
   *Por qué importa:* cualquier cosa que use el header arrastra el módulo de fichaje.

2. **`modules/mailing/send-document-actions.ts` → `modules/contracts/pdf-generator.ts`**
   El módulo de correo (genérico) conoce al de contratos (concreto) para generar su PDF.
   Y a la vez `contracts/actions.ts` importa `mailing/send-document-actions.ts` → círculo.

---

## 🟠 Dependencias circulares entre archivos (ciclos reales)
Grupos de archivos que se importan en círculo (estáticamente):

1. **`modules/points/award.ts` ↔ `modules/points/milestones.ts`**
   - `award.ts:99` importa de `milestones.ts`
   - `milestones.ts:4` importa `getPointsSettings()` de `award.ts`
   - *(Es el que detecté antes.)* Suele resolverse moviendo lo común (p.ej. `getPointsSettings`/tipos) a un tercer archivo `points/shared.ts`.

2. **PDF + envío: `contracts/actions.ts` → `mailing/send-document-actions.ts` → `contracts/pdf-generator.ts` → `contracts/actions.ts`**
   (con `proposals/actions.ts` + `proposals/pdf-generator.ts` colgando del mismo nudo)
   - `mailing/send-document-actions.ts` importa `generateContractPdf()` y `generateProposalPdf()`.
   - `contracts/pdf-generator.ts` importa `getContract/getContractItems/getContractPayments` de `contracts/actions.ts`.
   - `contracts/actions.ts` importa `mailing/send-document-actions.ts`.
   - *Sugerencia:* que `send-document-actions` reciba el PDF ya generado (inyección) en vez de importar cada generador.

3. ~~**`modules/config/products/attributes-config.tsx` ↔ `modules/products`**~~ ✅ **RESUELTO (2026-06-09)**
   - Era el que introduje yo en la Fase A al reutilizar `AttrForm`.
   - Arreglo: `AttrForm` (+ `TYPES`/`TYPE_LABEL`) movido a `modules/products/attr-form.tsx`. Ahora
     tanto `config/attributes-config` como `products/categories-manager` lo importan desde `products`.
   - Verificado con `graphify`: el ciclo `config ↔ products` ya no aparece. Build OK.

---

## 🟡 Acoplamiento entre funcionalidades (funciona, pero acopla)
Dos features que se importan mutuamente. No rompe, pero dificulta tocar una sin la otra:

- **contracts ↔ customers**: `contracts/pre-sign-modal.tsx` usa acciones de clientes; `customers/from-proposal-banner.tsx` usa `createContractFromProposal()`.
- **contracts ↔ installations**: `contracts/create-installation-button.tsx` ↔ `installations/installation-wizard.tsx` (usa `CollectInline` de contracts).
- **contracts ↔ mailing**: varios archivos de contracts usan mailing (normal: enviar), pero el cruce malo es el del punto 🔴-2.

---

## ⚪ Ruido / falsos positivos (no tocar)
- **`shared/lib` ↔ `shared/ui`**: todo `shared/ui/*` importa `cn()` de `shared/lib/utils.ts`. Eso es correcto (ui usa utilidades). El "retorno" lib→ui aparece solo por una arista *inferida/llamada*, no por un import real. **Benigno.**
- **SCC gigante de 15 módulos de negocio** (config, contracts, customers, invoices, leads, products, proposals, warehouses…): aparecen como un único bloque mutuamente conectado. Esto es **esperable** en esta app: las server actions se llaman entre módulos vía `await import(...)` (carga diferida). No es un bug por pareja; solo indica que la capa de negocio no está estrictamente estratificada. No accionable de momento.

---

## Otro hallazgo (secundario)
- **1.038 nodos débilmente conectados**: símbolos exportados con muy pocas (o ninguna) referencia
  entrantes → posible **código muerto** o cableado que falta. Es otro eje de auditoría (limpieza de
  huérfanos), distinto al de ciclos. Si quieres, lo saco en una lista aparte.

---

## Resumen / prioridad sugerida (para cuando quieras actuar — hoy NO)
1. 🔴 `header.tsx → time-clock-widget` (sacar el widget fuera de `shared/components`).
2. 🔴/🟠 Nudo PDF+envío contracts/proposals/mailing (inyectar el PDF, no importar generadores).
3. 🟠 Ciclo `points/award ↔ milestones` (mover lo común a un tercer archivo).
4. ✅ Ciclo `config ↔ products` — HECHO (AttrForm movido a `products/attr-form.tsx`).
5. 🟡 Acoplamientos contracts↔customers / contracts↔installations (revisar si compensa desacoplar).

Cómo re-auditar tras cambios (sin coste): `graphify update .` y volver a mirar ciclos.
Consultas útiles: `graphify explain "send-document-actions.ts"`, `graphify path "modules/points" "modules/products"`.
