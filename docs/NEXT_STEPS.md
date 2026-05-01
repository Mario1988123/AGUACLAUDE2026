# NEXT_STEPS.md — AGUACLAUDE2026

> **Próximos pasos concretos.** Solo "lo que toca ahora". Cuando una acción se hace, se borra de aquí (queda registrada en `PROJECT_MEMORY.md` § 7 Estado de avance).

Última actualización: 2026-05-01.

---

## 🎯 Acción inmediata

**Owner debe responder a las dudas críticas para desbloquear Capa 1.** Ver `PROJECT_MEMORY.md` § 8.

Mínimo necesario para avanzar:
- **#1** Offline-first (sí/no)
- **#2** Versionado propuestas/contratos (versionado/sobreescribe)
- **#5** Numeración fiscal (TicketBAI / Verifactu / no aplica todavía)
- **#7** i18n desde inicio (sí/no — solo español por ahora)
- **#8** Polimorfismo timeline (tabla única `events` / tabla por subject)
- **#11** Permisos: roles fijos / admin define a la carta
- **#17** Pruebas gratuitas: contrato en pruebas / entidad separada

---

## ✅ Hecho hoy (2026-05-01)

- Repo GitHub privado `Mario1988123/AGUACLAUDE2026` creado.
- `.gitignore` con blindaje de secretos commiteado y pusheado a `main`.
- Vercel CLI logueado en local (no enlazado al repo todavía).
- Token Supabase Management válido (usuario `mario.ortigueira@osmofilter.com`).
- Proyecto Supabase creado: `AGUACLAUDE2026` (`pkgvzwunazzkstlfubnq`) en org OSMOFILTER SL, región `eu-west-3`.
- API keys + DB password guardadas en `.env.local` (gitignored).
- `.env.example` plantilla creada (commiteable).
- Análisis Capa 0 completado (este doc + 3 más).
- 4 archivos memoria creados: `PROJECT_MEMORY.md`, `DATABASE_MEMORY.md`, `MODULES_MEMORY.md`, `NEXT_STEPS.md`.

---

## ⏳ Pendiente — Bloquea avance

### Pendiente owner (humano)
- [ ] Responder dudas críticas (mínimo #1, #2, #5, #7, #8, #11, #17). Ver `PROJECT_MEMORY.md` § 8.
- [ ] Confirmar stack técnico (`PROJECT_MEMORY.md` § 3).
- [ ] Confirmar OK para que Claude proceda a Capa 1 con las decisiones aprobadas.
- [ ] **Rotar token GitHub** (`ghp_...`) cuando termine la sesión — quedó pegado en historial chat.
- [ ] **Rotar token Supabase Management** (`sbp_...`) cuando terminemos el setup inicial.

### Pendiente Claude (cuando owner desbloquee)
- [ ] Capa 1: diseñar arquitectura multi-tenancy + permisos. Salida = diagrama + tablas core (companies, users, roles, permissions, modules, company_modules).
- [ ] Capa 2: modelo BD completo. Salida = migraciones SQL numeradas en `supabase/migrations/`.
- [ ] Capa 3: scaffold Next.js + auth + sidebar dinámico + PWA + validaciones ES + sistema toast.
- [ ] `vercel link` + inyectar env vars Supabase en Vercel (production + preview).
- [ ] Configurar GitHub Actions: typecheck + lint + build en cada push a `main`.

---

## 📋 Comandos pendientes que debe ejecutar el owner

> Por ahora ninguno. Los próximos serán SQL para Supabase (cuando empecemos Capa 2).

---

## 🗄️ SQL pendiente para Supabase

> Vacío. La primera migración llegará al inicio de Capa 2.

**Política:** todo SQL irá numerado en `supabase/migrations/NNNNN_descripcion.sql`. Antes de pedir al owner que lo ejecute en el SQL Editor de Supabase, Claude marcará:
- ✅ **Seguro** (idempotente, no destruye datos).
- ⚠️ **Atención** (modifica esquema o datos — requiere backup o confirmación previa).
- 🚫 **Destructivo** (borra columnas/tablas — explicación obligatoria).

---

## 🔍 Validaciones manuales necesarias

> Vacío todavía.

Aparecerán cuando haya pantallas que requieran prueba de UX táctil que Claude no puede ejecutar.

---

## 📌 Recordatorios para Claude (futuras conversaciones)

1. **Antes de proponer cualquier cambio** lee `PROJECT_MEMORY.md` + `DATABASE_MEMORY.md` + `MODULES_MEMORY.md` + este archivo.
2. **Antes de crear una tabla** revisa § 5 anti-duplicación de `DATABASE_MEMORY.md`.
3. **Antes de crear un módulo** revisa el detalle en `MODULES_MEMORY.md`.
4. **Después de cualquier cambio** actualiza el archivo de memoria correspondiente y `NEXT_STEPS.md`.
5. **Si el contexto es largo**, indica al owner: *"Copia y pega en el próximo chat el contenido de PROJECT_MEMORY.md, DATABASE_MEMORY.md, MODULES_MEMORY.md y NEXT_STEPS.md antes de continuar."*
