# NEXT_STEPS.md — AGUACLAUDE2026

> **Próximos pasos concretos.** Solo "lo que toca ahora". Cuando una acción se hace, se borra de aquí (queda registrada en `PROJECT_MEMORY.md` § 7 Estado de avance).

Última actualización: 2026-05-01.

---

## 🎯 Acción inmediata

**Modo de trabajo confirmado:** Claude trabaja en autónomo escribiendo TODO en el repo (migraciones + scaffold + módulos), capa a capa, parando solo para dudas. Owner audita al final y aplica deploy + SQL.

**Capa 2 cerrada.** 16 migraciones SQL escritas, ~70 tablas, RLS completa, seeds.
**Próximo: Capa 3 — Scaffold Next.js + auth + sidebar + PWA + utilidades ES.**

Tareas pendientes Capa 3:
- package.json con stack final (Next 15, React 19, TS, Tailwind 4, shadcn, Supabase SSR).
- Config: tsconfig, next.config, tailwind.
- Estructura `src/app`, `src/modules`, `src/shared`.
- Supabase clients (browser, server, middleware) con `@supabase/ssr`.
- middleware.ts: auth + multi-tenant guard + redirección por rol.
- Layout AppShell + Sidebar dinámico + Header con notificaciones.
- Login + recuperación contraseña + cambio obligatorio.
- Sistema toast (verde/rojo/naranja).
- Validaciones ES: DNI, CIF, IBAN, CP, teléfono.
- PWA: manifest.webmanifest + service worker con Serwist.
- Pantalla error/no-permisos.

---

## ✅ Hecho hoy (2026-05-01)

- Repo GitHub privado `Mario1988123/AGUACLAUDE2026` creado.
- `.gitignore` con blindaje de secretos.
- Vercel CLI logueado.
- Proyecto Supabase `AGUACLAUDE2026` creado (`pkgvzwunazzkstlfubnq`, eu-west-3).
- API keys + DB password en `.env.local` (gitignored).
- `.env.example` plantilla.
- **Capa 0** ✅ Análisis completo + 4 archivos memoria + 7/7 dudas críticas resueltas.
- **Capa 1** ✅ Cerrada. 13/13 preguntas resueltas. ADR 0001.
- **Capa 2 base** ✅ 7 migraciones SQL escritas:
  - Extensiones, schema `app`, enums, trigger updated_at.
  - 6 tablas globales (companies, superadmins, catálogos).
  - 6 tablas tenant Capa 1 (settings, modules, profiles, roles, teams, overrides).
  - 9 funciones helper en `app` para RLS.
  - Auth Hook `custom_access_token_hook`.
  - RLS habilitada y policies en TODAS las 12 tablas.
  - Seeds: 19 módulos + 8 roles + permissions_catalog completo + role_permissions según ADR 0001.
- `supabase/config.toml` para Supabase CLI local.
- Decisiones: paso a paso, todo en código primero, deploy + auditoría al final.

---

## ⏳ Pendiente — Bloquea avance

### Pendiente owner (humano)
- [ ] Responder dudas críticas (mínimo #1, #2, #5, #7, #8, #11, #17). Ver `PROJECT_MEMORY.md` § 8.
- [ ] Confirmar stack técnico (`PROJECT_MEMORY.md` § 3).
- [ ] Confirmar OK para que Claude proceda a Capa 1 con las decisiones aprobadas.
- [ ] **Rotar token GitHub** (`ghp_...`) cuando termine la sesión — quedó pegado en historial chat.
- [ ] **Rotar token Supabase Management** (`sbp_...`) cuando terminemos el setup inicial.

### Pendiente Claude
- [x] Capa 1: arquitectura multi-tenancy + permisos. ✅ ADR 0001 aprobado.
- [ ] **Capa 2 (ahora):** crear `supabase/migrations/` con SQL numerado: tipos, tablas globales, tablas tenant Capa 1, tablas negocio Capa 2, RLS, seeds, vistas, funciones helpers (`auth.company_id`, `auth.can`).
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
