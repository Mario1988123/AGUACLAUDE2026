# Plan — flujo completo de la prueba gratuita (2026-11-26)

Sale de la nota de voz de Mario del 26-11 y de la auditoría del código del mismo día.

## Flujo que quiere Mario

1. El comercial crea el lead y le genera la prueba con los días y horas que le vienen al cliente.
2. Al admin (Lara, Orlando) le salta un aviso que no se puede ignorar: push en el móvil y una ventana en el panel
   que tiene que cerrar.
3. El admin llama al cliente, pone el día y la hora reales (mandan aunque no coincidan) y el instalador.
4. La instalación sale en /instalaciones (al admin y al instalador) y en la agenda. **HECHO el 26-11 (7a24394).**
5. El instalador instala la Esencial (de pie o de sobremesa) y marca si el sitio es definitivo o provisional.
6. El lead vuelve al comercial con la cuenta atrás: 10 días por defecto, editable.
7. Pasados los días, el comercial llama y decide: **se retira**, **se la queda en alquiler** (solo Esencial pie
   o sobremesa) o **se la queda en compra** (cualquier equipo con precio de venta).
8. Si se la queda, hay que decidir qué pasa con el equipo (respuesta de Mario, 26-11):
   - se queda como está (definitivo);
   - se queda, pero hay que agendar una reinstalación para fijarlo;
   - quiere el servicio pero con otro equipo: se retira el de prueba y se instala uno nuevo.
   «Se retira» a secas = venta perdida: se desinstala la prueba y el lead pasa a perdido.
   Aviso al admin: al entrar si hay pruebas sin agendar y en directo al llegar una (respondido).
   Sin decisión: aviso 2 días antes, el día que termina y luego diario al comercial y al admin (respondido).
9. Nunca se queda en un estado neutro. Una vez instalado, pasa a gestión.
10. Después (siguiente fase): formas de pago si es venta, y firma y condiciones si es alquiler. Ya existe en contratos.

## Huecos encontrados y arreglo

| # | Hueco | Arreglo |
|---|---|---|
| H1 | El modal «Firmar e instalar» tiene «Día específico»: deja la prueba agendada sin instalación ni cita y pisa la fecha del admin. Además, cualquiera (también el comercial) puede firmar e instalar. | Quitar «Día específico» del modal: agendar solo desde la tarjeta de agendar. «Firmar e instalar», solo para el instalador asignado, el admin y el director técnico. |
| H2 | El aviso al admin es un toast de 12 s, solo si la app estaba abierta, y solo una vez. | Ventana que tapa la pantalla con las pruebas por agendar. Sale al entrar y cada vez que llega una nueva, y no se quita hasta pulsar «Entendido». Vuelve a salir mientras siga habiendo pruebas sin agendar (como mucho una vez por sesión, y otra cuando entra una nueva). |
| H3 | Al instalar, el comercial no se entera. | Aviso (push) al comercial: «Instalada la prueba de X · termina el día D». |
| H4 | La duración no se puede cambiar después de crear la prueba. | Editar los días en la ficha de la prueba mientras no esté decidida; recalcula el final. |
| H5 | El cron de caducidad avisa al instalador y sin push; no hay aviso previo. | Aviso por push al comercial del lead (o a quien creó la prueba) 2 días antes y el día que termina: «Llama al cliente y decide». |
| H6 | Una prueba caducada no se puede aceptar (solo retirar). Y desaparece de la ficha del lead, que deja pedir otra con el equipo aún instalado. | Caducada = «pendiente de decisión»: se puede aceptar, retirar o rechazar. La ficha del lead la sigue enseñando. |
| H7 | Aceptar no pregunta qué pasa con el equipo, no deja cambiar de producto, no limita el alquiler a la Esencial y viene «renting» por defecto. El «provisional» no se usa para nada. | El modal «Se la queda» pide: 1) alquiler o compra; 2) el equipo (alquiler: solo los marcados para prueba; compra: cualquiera con precio de venta, por defecto el de la prueba); 3) qué se hace con el equipo instalado (las 4 opciones). Según la opción, crea la reubicación, la retirada o la instalación nueva, enlazadas al contrato. |
| H8 | Rechazar o retirar deja el lead en «prueba propuesta» para siempre. | Rechazar/retirar → lead a «perdido» con el motivo; la retirada se agenda en el mismo paso. |
| H9 | Prueba agendada con la fecha pasada y sin instalar: nadie se entera. | El cron diario avisa al admin («instalación de prueba sin hacer»). |
| H10 | Si la empresa no ha marcado ningún producto para prueba, se ofrecen todos. | Se deja así, pero con un aviso en el alta para el admin. |

[decide] El lead no cambia de estado al instalar: sigue en «prueba propuesta» y su ficha ya enseña «prueba activa ·
quedan N días». Crear un estado nuevo obliga a tocar el enum y todos sus filtros, y no aporta nada.

## Orden de trabajo

1. H1 + H6 + H8 (cerrar las salidas sin destino).
2. H3 + H4 + H5 + H9 (avisos y cuenta atrás).
3. H2 (ventana emergente).
4. H7 (aceptar con destino del equipo). Es el más grande.
5. Siguiente fase con Mario: cobro de la venta y firma del alquiler desde el contrato que se crea.
