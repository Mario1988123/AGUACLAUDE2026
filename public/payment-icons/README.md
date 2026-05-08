# Iconos de métodos de pago

Sube aquí tus iconos. El componente `PaymentMethodBadge` los carga
automáticamente si existen, y cae a un icono Lucide por defecto si no.

## Formato y tamaño

**Ideal: SVG** — escala perfecto a cualquier tamaño y pesa menos.
- ViewBox `0 0 24 24` o `0 0 32 32` recomendado.
- Color: tal cual (con sus colores oficiales — Bizum azul/naranja, Visa,
  etc.). El badge ya tiene fondo neutral, así que el icono debe destacar.

**Alternativa: PNG transparente** — si te dan un PNG ya hecho.
- Tamaño: **64×64 px** (se renderiza a 18×18 con buen detalle en HiDPI).
- Fondo transparente.

**JPG NO** — no soporta transparencia y se ve raro sobre el fondo del badge.

## Nombres exactos de archivo

Pon estos nombres exactamente, en minúscula. La extensión puede ser
`.svg` o `.png` indistintamente.

| Archivo            | Método             |
| ------------------ | ------------------ |
| `cash.svg`         | Efectivo           |
| `card.svg`         | Tarjeta            |
| `bizum.svg`        | Bizum              |
| `transfer.svg`     | Transferencia      |
| `direct_debit.svg` | SEPA / Domiciliación |
| `financing.svg`    | Financiera         |

## Cómo añadirlos

1. Pon los archivos en esta carpeta (`public/payment-icons/`).
2. Commit + push a GitHub. Vercel re-deploya automáticamente.
3. Refresca cualquier página con badges (ej. `/wallet`) y verás los
   nuevos iconos.

## Comprobar

En el navegador `https://aguaclaude2026.vercel.app/payment-icons/cash.svg`
debe abrir tu icono. Si da 404, el archivo no se ha subido bien.

## Si no subes nada

El sistema funciona igual con los iconos de Lucide por defecto —
no rompe nada.
