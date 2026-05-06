# Verifactu — Guía de implementación

> Implementado en CRM AGUACLAUDE2026 — 2026-05-07

## Marco legal
- **RD 1007/2023** — Reglamento que regula los Sistemas Informáticos de Facturación (SIF).
- **Orden HAC/1177/2024** — especificaciones técnicas (XSD, hash, QR, firma).
- **RD 254/2025** — calendario de obligatoriedad y aclaraciones.
- **Ley 18/2022 antifraude** — base habilitante.

## Calendario obligatoriedad
| Tipo de empresa | Fecha límite |
|---|---|
| Grandes empresas (>€6M facturación) | **1 enero 2026** (ya en producción) |
| Resto de empresas (PYMES, SL, SA) | **1 enero 2027** |
| Autónomos | **1 julio 2027** |

Quien NO está obligado:
- Operadores en SII (Suministro Inmediato AEAT) — ya envían más detalle.
- País Vasco/Navarra: TicketBAI sustituye a Verifactu.
- Ciertos regímenes especiales (consultar AEAT).

## Modos de operación
- **VERI*FACTU**: cada factura se envía a la AEAT en tiempo real (recomendado, menos auditoría requerida).
- **NO VERI*FACTU**: factura se firma con XAdES y queda solo en el sistema (más auditoría exigida y certificación más estricta).

El CRM por defecto opera en modo `no_envio` hasta que el admin configure un certificado FNMT y active `verifactu` en `/configuracion/fiscal`.

## Implementación en este CRM

### Tablas BD (migración `20260507200000_invoicing_verifactu.sql`)
- `invoice_series` — series correlativas por empresa.
- `invoices` — cabecera con `verifactu_hash`, `verifactu_prev_hash`, `verifactu_qr_url`.
- `invoice_lines` — líneas con IVA por línea.
- `invoice_taxes` — desglose de IVA por tipo.
- `invoice_verifactu_records` — **CADENA INMUTABLE** (trigger que bloquea UPDATE/DELETE).
- `invoice_verifactu_events` — audit log del software (obligatorio).
- `invoice_aeat_submissions` — cola de envíos a AEAT con reintentos.
- Función `allocate_next_invoice_number(series_id)` — atómica con `FOR UPDATE`.

### Hash SHA-256 encadenado
`src/modules/invoices/verifactu.ts → computeVerifactuHash()`. Usa el formato oficial:
```
IDEmisorFactura={NIF}&NumSerieFactura={SERIE}-{NUM}&FechaExpedicionFactura={DD-MM-YYYY}&TipoFactura={F1}&CuotaTotal={X.XX}&ImporteTotal={X.XX}&Huella={prev_hash}&FechaHoraHusoGenRegistro={ISO}&
```
SHA-256 hex en mayúsculas.

### QR
`buildVerifactuQrUrl()` produce:
```
https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif={NIF}&numserie={SERIE/NUM}&fecha={DD-MM-YYYY}&importe={X.XX}
```
(En modo test: `prewww2.aeat.es`).

### Server actions
- `listInvoiceSeries`, `upsertInvoiceSeriesAction`
- `listInvoicesV2`, `createInvoiceFromContractV2Action`
- **`issueInvoiceV2Action`** — numera + hash + QR + registro inmutable
- **`cancelInvoiceV2Action`** — registro de anulación encadenado
- `markInvoicePaidAction`

### Aún por hacer (siguiente iteración)
1. **PDF con QR embebido**: usar `pdf-lib` + `qrcode` para renderizar PDF descargable.
2. **Subida de certificado FNMT** (.p12 cifrado AES-256 en `company_settings.verifactu_cert_encrypted`).
3. **Cron de envío AEAT** (`/api/cron/verifactu-send`) que procese `invoice_aeat_submissions` pendientes.
4. **Generación XML** del registro `RegistroFacturacionAlta` según XSD oficial.
5. **Firma XAdES** del XML (modo NO VERI*FACTU).
6. **Cliente SOAP** a sede AEAT con certificado.
7. **Rectificativas R1-R5** (UI + flow).
8. **Facturación masiva** (todas las cuotas mensuales activas).
9. **Página `/configuracion/facturacion`** para gestionar series, ver eventos del software, configurar modo Verifactu.

### Textos legales
- **Modo VERI*FACTU**: "Factura verificable en la sede electrónica de la AEAT. Sistema de Facturación Verificable (Verifactu)."
- **Modo NO VERI*FACTU**: "Factura emitida por sistema informático de facturación conforme al Reglamento RD 1007/2023."
