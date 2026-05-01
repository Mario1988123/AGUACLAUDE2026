# NEXT_STEPS.md — AGUACLAUDE2026

> **Próximos pasos concretos.** Solo "lo que toca ahora". Cuando una acción se hace, se borra de aquí (queda registrada en `PROJECT_MEMORY.md` § 7 Estado de avance).

Última actualización: 2026-05-01.

---

## 🎯 Acción inmediata

**Owner debe responder a las 13 preguntas Capa 1** (`PROJECT_MEMORY.md § 11`) para cerrar la matriz de permisos y poder pasar a Capa 2 (modelo BD completo).

**Bloqueantes mínimos para arrancar Capa 2:**
- **1.1** Multi-empresa por usuario (sí/no)
- **1.2** Multi-departamento por usuario (sí/no)
- **1.7** Qué ve exactamente el instalador del cliente
- **1.12** ¿Varios admins por empresa o uno solo?
- **1.13** ¿Departamentos fijos o configurables?

El resto (1.3-1.6, 1.8-1.11) se pueden ir resolviendo en paralelo durante Capa 2.

---

## ✅ Hecho hoy (2026-05-01)

- Repo GitHub privado `Mario1988123/AGUACLAUDE2026` creado.
- `.gitignore` con blindaje de secretos commiteado y pusheado a `main`.
- Vercel CLI logueado en local (no enlazado al repo todavía).
- Token Supabase Management válido (usuario `mario.ortigueira@osmofilter.com`).
- Proyecto Supabase creado: `AGUACLAUDE2026` (`pkgvzwunazzkstlfubnq`) en org OSMOFILTER SL, región `eu-west-3`.
- API keys + DB password guardadas en `.env.local` (gitignored).
- `.env.example` plantilla creada (commiteable).
- Análisis **Capa 0** completado.
- 4 archivos memoria creados: `PROJECT_MEMORY.md`, `DATABASE_MEMORY.md`, `MODULES_MEMORY.md`, `NEXT_STEPS.md`.
- **Capa 0 cerrada** con 7/7 dudas críticas respondidas por owner.
- **Capa 1 — diseño** documentado en `docs/decisions/0001_capa1_arquitectura_permisos.md`:
  - Modelo de actores con superadmin + tenants + 8 roles fijos.
  - Tablas core globales y tenant para multi-tenancy y permisos.
  - Estructura `permissions_catalog` (module × action × scope + field_restrictions).
  - Matriz de permisos completa por rol/módulo.
  - RLS pattern definitivo con `auth.company_id()` y `auth.can()`.
  - Custom JWT claims previstos.
  - 13 preguntas Capa 1 abiertas para cerrar zonas grises de la matriz.

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
