// =============================================================================
// database.types.ts
// PLACEHOLDER hasta hacer `supabase gen types typescript --project-id pkgvzwunazzkstlfubnq`.
// Tipo `any` para máxima compatibilidad con queries dinámicas en build prod.
// =============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
