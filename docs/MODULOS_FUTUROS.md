# Módulos futuros — ideas para sorprender

> Brainstorm 2026-05-07 — para implementar a partir del 2026-05-08.
> Cada bloque tiene un **Prompt sugerido** para retomarlo.

---

## 🎓 1. AquaAcademy — Formación interna gamificada

**Pitch**: portal de aprendizaje dentro del CRM. Cada rol tiene su currículum:
- Comerciales aprenden técnicas de venta + producto.
- Técnicos aprenden montaje, calidad agua, normativa.
- Telemarketers aprenden scripts.

**Funcionalidad**:
- **Cursos** organizados en módulos → lecciones (texto, video, PDF).
- **Tests** finales (multi-respuesta, drag-drop, casos prácticos).
- **Certificación** descargable PDF al aprobar (sello AquaAcademy + fecha).
- **Niveles**: Bronze → Silver → Gold → Platinum según horas + tests aprobados.
- **Leaderboard** mensual por departamento.
- **Recordatorios** push: "Llevas 3 días sin completar ninguna lección".
- **Onboarding** automático: usuario nuevo entra → sus primeros 5 cursos obligatorios.

**Tablas BD**:
- `academy_courses (id, company_id, title, description, role_target, level, duration_min, is_mandatory)`
- `academy_lessons (id, course_id, order, title, content_md, video_url, duration_min)`
- `academy_quizzes (id, lesson_id, questions jsonb)`
- `academy_attempts (id, user_id, quiz_id, score, passed, attempted_at)`
- `academy_certificates (id, user_id, course_id, issued_at, certificate_pdf_url)`
- `academy_progress (user_id, lesson_id, completed_at, time_spent_seconds)`

**Integración con puntos del CRM existentes**:
- 50 pts por lección completada.
- 200 pts por curso aprobado.
- 1000 pts por certificación Gold.

**Gamificación extra**: badges por dominio (Experto Ósmosis, Maestro Cierre, Pro Calidad Agua...).

**Prompt para retomar**:
> "Implementa AquaAcademy según docs/MODULOS_FUTUROS.md sección 1. Empieza por la BD + UI listado de cursos por rol. Las lecciones son markdown con video opcional embebido. Quiz al final con 5 preguntas. Aprobado >= 80%."

---

## 📚 2. Knowledge Base (KB) — Solución incidencias técnicas

**Pitch**: Base de conocimiento para que el técnico, ANTES de llamar al jefe, busque la solución a la incidencia.

**Funcionalidad**:
- Artículos categorizados por: equipo (Senda / Brisa / etc.), síntoma, tipo de instalación.
- **Búsqueda full-text** en español (PostgreSQL `tsvector` con configuración 'spanish').
- Cada artículo: pasos numerados + fotos + video opcional.
- Artículos votables por los técnicos ("Me ayudó / No me ayudó").
- **Auto-sugerencia**: cuando el técnico crea una incidencia con título "Fuga grifo", el sistema le sugiere los 3 artículos más relevantes ANTES de mandarla.
- **Artículos generados de incidencias resueltas**: el director técnico puede convertir una incidencia bien resuelta en artículo KB ("publicar como solución").

**Tablas BD**:
- `kb_categories (id, company_id, name, parent_id, icon)`
- `kb_articles (id, company_id, category_id, title, body_md, search_vector tsvector, views_count, helpful_count, not_helpful_count, published_at, author_id)`
- `kb_article_attachments (id, article_id, kind, url, caption)`
- `kb_article_votes (article_id, user_id, helpful boolean)`
- `kb_search_log (id, user_id, query, clicked_article_id)` — para mejorar el ranking

**Integración**: en `/incidencias/[id]` añadir botón "Buscar en KB" que abre lateral con artículos relevantes.

**Prompt para retomar**:
> "Implementa Knowledge Base según docs/MODULOS_FUTUROS.md sección 2. Empieza por BD + página /kb con búsqueda + categorías. La auto-sugerencia en incidencias la hago en una segunda iteración."

---

## 💧 3. AquaCoach — Recordatorios automáticos al cliente

**Pitch**: cada cliente con equipo instalado recibe recordatorios automáticos por WhatsApp/email:
- "Tu filtro Senda lleva 5 meses, recuerda cambiarlo en septiembre."
- "Tip: para alargar la vida del equipo, limpia las membranas cada 6 meses."
- "Análisis de calidad del agua de tu zona — septiembre 2026: dureza media 32°fH..."

**Tablas BD**:
- Aprovecha `customer_equipment` existente.
- Nueva: `equipment_maintenance_schedules` con calendario automático por modelo.
- `customer_communications` log de mensajes enviados.
- `aquacoach_templates` mensajes plantilla por evento.

**Canales**: WhatsApp Business API + email + push notification.

**Beneficio comercial**: clientes contentos = renovaciones + referidos. Los recordatorios pueden llevar CTA ("Reservar mantenimiento ahora" → genera trabajo de mantenimiento en CRM).

**Prompt para retomar**:
> "Implementa AquaCoach según docs/MODULOS_FUTUROS.md sección 3. Empieza por la BD + cron diario que mira customer_equipment con próximo cambio en X días y encola mensaje."

---

## 🏆 4. Programa Referidos

**Pitch**: el cliente recomienda → recibe recompensa.

**Funcionalidad**:
- Cada cliente tiene un **código único** ("MARIA-2026").
- Si un nuevo lead se registra con ese código, queda atado.
- Si el lead acaba firmando contrato → el cliente original recibe X € o Y meses gratis.
- Dashboard "Mi programa de referidos" en la ficha del cliente.
- Notificación push al cliente cuando alguien usa su código.

**Tablas BD**:
- `referral_codes (id, customer_id, code, created_at, is_active)`
- `referral_uses (id, code_id, lead_id, customer_id_created, signed_contract_id, reward_paid_at, reward_amount_cents)`

**Comercial**: campañas tipo "Refiere y gana mes gratis" → top of mind del cliente.

**Prompt para retomar**:
> "Implementa Programa Referidos según docs/MODULOS_FUTUROS.md sección 4."

---

## 📊 5. Dashboard ROI por cliente

**Pitch**: para cada cliente, ver coste total acumulado vs ingresos generados → margen real.

**Cálculos**:
- Coste = (productos instalados a precio coste) + (mantenimientos × tiempo técnico × tarifa) + (incidencias × tiempo).
- Ingreso = (cuotas cobradas) + (cuotas previstas restantes).
- Tiempo de vida media (LTV) en meses.
- Probabilidad de churn (basado en histórico de incidencias).

**Vista**: gráfico de barras coste/ingreso por mes + KPI grande "Margen neto: €X".

**Prompt para retomar**:
> "Implementa dashboard ROI por cliente según docs/MODULOS_FUTUROS.md sección 5."

---

## 🗺️ 6. Mapa de calor + Cluster geográfico

**Pitch**: ver en un mapa de España todos los clientes/instalaciones/incidencias.

**Funcionalidad**:
- Mapa Leaflet (open source) con marcadores por cliente.
- Heatmap de densidad por código postal.
- Filtros: estado contrato, tiene incidencias abiertas, sin mantenimiento >12 meses.
- Cluster automático en zoom alejado.
- Click en marcador → ficha cliente.

**Beneficio**: optimizar rutas de instaladores. Detectar zonas con muchas incidencias = problema de instalador / agua local.

**Prompt para retomar**:
> "Implementa Mapa Leaflet de clientes según docs/MODULOS_FUTUROS.md sección 6. Las coordenadas están en addresses.latitude/longitude."

---

## 💰 7. Pricing dinámico — sugerencia de precios

**Pitch**: el comercial está creando una propuesta. El sistema sugiere precio óptimo basado en:
- Histórico de aceptación por rango de precio.
- Zona geográfica del cliente.
- Tipo de cliente (particular / empresa).
- Temporada (verano más demanda).
- Comisión del comercial.

**Output**: "Precio mínimo aceptable: €1450, Precio óptimo: €1620, Precio máximo realista: €1850. Aceptación media a este precio: 72%."

**Modelo**: empezar con regresión simple sobre histórico, evolucionar a ML.

**Prompt para retomar**:
> "Implementa pricing dinámico según docs/MODULOS_FUTUROS.md sección 7. Empieza por estadísticas básicas sobre proposals.status=accepted vs proposals.status=rejected."

---

## 📞 8. Encuesta NPS automática

**Pitch**: 7 días después de completar instalación, mandar encuesta NPS al cliente.

- "¿Recomendarías nuestro servicio? 0-10"
- Si <=6 → DETRACTOR → notificación al admin para llamada de recuperación.
- Si 7-8 → PASIVO → email con descuento próxima compra.
- Si 9-10 → PROMOTOR → email con código de referidos (sección 4).

**KPI**: NPS = (% promotores) - (% detractores).

**Tablas BD**:
- `nps_surveys (id, customer_id, installation_id, sent_at, score, comment, responded_at)`

**Prompt para retomar**:
> "Implementa NPS automático según docs/MODULOS_FUTUROS.md sección 8."

---

## 🤖 9. Asistente IA del comercial

**Pitch**: chat lateral con IA entrenada en:
- Catálogo de la empresa (productos, precios, duraciones).
- Histórico de incidencias resueltas (KB).
- Normativa (calidad del agua, instalación).

El comercial pregunta "¿Qué equipo le recomiendo a un cliente con dureza 45°fH y 4 personas?" y la IA responde con justificación + 3 opciones priorizadas.

**Stack**: Anthropic Claude API (claude-haiku-4-5 para latencia, claude-sonnet-4-6 para razonamiento profundo).
- Embeddings de catálogo + KB en pgvector.
- RAG pipeline.

**Prompt para retomar**:
> "Implementa asistente IA según docs/MODULOS_FUTUROS.md sección 9. Empieza por estudiar pgvector y los embeddings necesarios."

---

## 📅 10. Auto-programación de mantenimientos

**Pitch**: el sistema mira las cargas de los técnicos y sugiere automáticamente el mejor día/hora para cada mantenimiento programado.

- Considera: zona geográfica del cliente vs ruta del técnico, carga del día, preferencias del cliente, urgencia.
- Algoritmo: optimización tipo TSP (Traveling Salesman simplificado) por día.

**Output**: panel "Auto-programar 12 mantenimientos pendientes" → propone 12 slots → admin acepta o ajusta.

**Prompt para retomar**:
> "Implementa auto-programación según docs/MODULOS_FUTUROS.md sección 10."

---

## 🔔 11. Workflows / Reglas automatizadas (low-code)

**Pitch**: el admin define reglas tipo IFTTT:
- "Si lead lleva 3 días sin contactar → notificar a su comercial."
- "Si contrato firmado pero sin instalación a los 7 días → notificar admin."
- "Si IBAN inválido en cobro → marcar para revisión."
- "Si incidencia abierta >48h → escalar a director técnico."

**UI**: editor visual tipo nodo-condición-acción.

**Prompt para retomar**:
> "Implementa motor de workflows según docs/MODULOS_FUTUROS.md sección 11."

---

## 🎯 12. Centro de ofertas — Marketing

**Pitch**: módulo para crear campañas:
- "Promo verano: -10% en mantenimientos"
- Aplicable a: todos / segmento (zona, antigüedad, equipos).
- Genera **landing page** propia (`/promo/CODIGO`) que el cliente visita.
- Lead que llega por la promo queda etiquetado.
- KPI: leads por campaña, conversión, ROI.

**Prompt para retomar**:
> "Implementa centro de ofertas según docs/MODULOS_FUTUROS.md sección 12."

---

## 📲 13. App móvil PWA-first para instaladores

**Pitch**: instalador entra desde su móvil → ve solo lo suyo → modo offline parcial:
- Lista de instalaciones del día.
- Mapa con ruta optimizada.
- Captura foto, firma sin cobertura → sync cuando vuelva.
- Voz a texto para notas (Web Speech API).

**Stack**: Service Worker (Serwist), IndexedDB, sincronización en background.

**Estado**: la PWA está aparcada (ver `feedback_pwa_sw.md`). Reactivar tras estabilizar BD.

**Prompt para retomar**:
> "Reactiva PWA y desarrolla flujo offline para instaladores según docs/MODULOS_FUTUROS.md sección 13."

---

## 🧪 14. Mini-CRM para análisis de agua

**Pitch**: subapp para que el comercial entre los datos del análisis del agua del cliente (dureza, pH, conductividad, hierro, nitratos...) y el sistema:
- Genera diagnóstico automático ("Agua muy dura, recomienda descalcificador").
- Recomienda equipos del catálogo.
- Genera informe PDF profesional para entregar al cliente.

**Tablas**:
- `water_analyses (id, customer_id, sampled_at, temperature, ph, conductivity, hardness_fH, iron_mgL, nitrate_mgL, ...)`
- `water_recommendations (id, analysis_id, product_id, reason)`

**Prompt para retomar**:
> "Implementa mini-CRM análisis agua según docs/MODULOS_FUTUROS.md sección 14."

---

## 🎬 15. Videoconsulta integrada

**Pitch**: el comercial agenda videollamada con cliente desde el CRM. Se genera link único (Daily.co / Whereby / Jitsi). Grabación opcional. Notas durante la llamada.

**Prompt para retomar**:
> "Implementa videoconsulta según docs/MODULOS_FUTUROS.md sección 15."

---

## Recomendación de orden de implementación

1. **AquaAcademy** + **KB** — alta retención de equipo, diferenciación.
2. **AquaCoach** — alta retención de cliente, ingresos recurrentes.
3. **Mapa de calor** — fácil + impacto visual inmediato.
4. **Programa referidos** — bajo coste + alto impacto comercial.
5. **NPS automático** — métrica clave de calidad.
6. **Pricing dinámico** — ROI alto cuando hay datos.
7. **Asistente IA** — wow factor pero requiere madurez datos.
8. **Workflows** — empoderar al admin.
9. **Auto-programación** — depende de tener carga real.
10. **Resto** según prioridad del usuario.
