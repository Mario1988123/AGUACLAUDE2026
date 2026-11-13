#!/usr/bin/env bash
# Despliegue de la noche del 2026-11-13 (un solo commit = un solo deploy).
# Validado en copia limpia sobre 29f81e2: tsc, next lint y 516 tests en verde.
# Todo funciona SIN las migraciones: lo nuevo de equipos e incluidos se oculta
# hasta aplicarlas. Uso (desde la raiz del repo):  bash scripts/manana/desplegar-todo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
xargs -d '\n' git add -- < scripts/manana/todo-ficheros.txt
git add -- scripts/manana
git commit -q -F - <<'MSG'
feat: modelo de equipo, mantenimientos incluidos, leads y avisos del panel

- Equipos: el tecnico identifica fuente/osmosis, gama y variante en el
  mantenimiento y queda fijo; variantes como hijos de la gama; etiqueta en
  fichas, Mi dia y Mi furgoneta; retirada sin modelo ya no se pierde;
  /clientes/equipos-pendientes.
- Mantenimientos incluidos: N visitas anuales gratis por equipo; despues
  «EMPEZAR A PAGAR» y marca «a cobrar» (sin factura automatica);
  /mantenimientos/empiezan-a-pagar.
- Leads: el cron avisa en vez de quitar; el cliente es de quien trabajo el
  lead; bolsa visible para el admin.
- Avisos: «sin contrato activo» sin contado ni heredados (salian 244);
  events.occurred_at en cuatro lecturas rotas; el recuento no suma centimos.
- Migraciones 20261113090000/100000/110000 sin aplicar: el codigo las detecta.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
cat <<'TXT'

Siguiente (en este orden):
  bash scripts/aplicar-migracion.sh \
    supabase/migrations/20261113090000_modelo_equipo_cliente.sql \
    supabase/migrations/20261113100000_leads_aviso_inactividad.sql \
    supabase/migrations/20261113110000_mantenimientos_incluidos.sql
Luego, con calma y mirando los recuentos (ver docs/MANANA_2026-11-13.md):
  scripts/datos_modelo_equipo_infinity.sql
  supabase/datos/20261113_leads_devolver_infinity.sql
  scripts/mant_incluido_propuesta_infinity.sql (parte 1 solo lectura)
  supabase/datos/20261113_limpieza_infinity.sql (limpieza: decide alcance antes)
TXT
