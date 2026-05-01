// =============================================================================
// database.types.ts
// AUTOGENERADO por `supabase gen types typescript --local`.
// Hasta ejecutar la generación, este placeholder permite que el proyecto
// compile. Tras `npm run supabase:gen-types` será reemplazado.
// =============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
