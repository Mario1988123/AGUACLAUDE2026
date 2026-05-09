/**
 * Plantilla por defecto del albarán de entrega de equipos en prueba.
 * Placeholders disponibles (se sustituyen al firmar):
 *   {cliente}            → razón social o nombre del cliente
 *   {direccion}          → dirección de instalación
 *   {equipo}             → nombre + nº serie del equipo en prueba
 *   {dias_prueba}        → duración acordada (días)
 *   {fecha_entrega}      → fecha de entrega
 *   {fecha_devolucion}   → fecha tope de devolución
 *   {empresa}            → nombre comercial de tu empresa
 *   {precio_renting_mes} → cuota orientativa mensual si decide quedarse
 *   {duracion_renting}   → meses de la cuota orientativa
 */
export const DEFAULT_FREE_TRIAL_CONDITIONS = `CONDICIONES DE ENTREGA DE EQUIPO EN PRUEBA

1. {empresa} entrega a {cliente} el equipo {equipo} en régimen de DEPÓSITO PROVISIONAL para una prueba de uso doméstico/profesional sin coste durante {dias_prueba} días, hasta el {fecha_devolucion}.

2. Este documento NO tiene carácter contractual de venta ni de arrendamiento. La propiedad del equipo permanece en todo momento de {empresa}. El cliente actúa como depositario.

3. La instalación, retirada y mantenimiento durante el periodo de prueba son GRATUITOS.

4. El cliente se compromete a:
   - Cuidar el equipo y mantenerlo en condiciones de uso normales.
   - No manipular el equipo ni permitir que terceros ajenos lo manipulen.
   - Notificar de inmediato cualquier avería, fuga o anomalía.
   - Devolver el equipo a primer requerimiento si no decide formalizar la contratación.

5. RESPONSABILIDAD POR DAÑOS Y PÉRDIDA:
   - Daños por uso indebido o negligencia: el cliente abonará el coste de reparación o, si fuera total, el valor de reposición del equipo.
   - Pérdida o sustracción del equipo: el cliente abonará el valor íntegro de reposición.
   - Valor de reposición orientativo del equipo: a indicar por la empresa en albarán.

6. Si transcurridos los {dias_prueba} días el cliente desea quedarse con el equipo, se formalizará el contrato correspondiente. Cuota orientativa: {precio_renting_mes} €/mes ({duracion_renting} meses).

7. Si el cliente no desea quedarse con el equipo, {empresa} retirará el equipo sin coste para el cliente.

8. El cliente declara haber leído y aceptado estas condiciones, y autoriza a {empresa} al tratamiento de los datos facilitados conforme a la normativa de Protección de Datos vigente.

Fecha de entrega: {fecha_entrega}
Lugar: {direccion}

Firma del cliente:                                Firma de {empresa}:`;
