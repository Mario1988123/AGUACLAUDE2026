// =============================================================================
// database.types.ts
// PLACEHOLDER hasta el deploy. Tras `supabase gen types typescript --local`
// (o `--project-id pkgvzwunazzkstlfubnq`) se reemplaza este archivo por la
// definición tipada real generada del esquema.
//
// Mientras tanto, definimos tipos suficientemente permisivos para que el
// código compile sin perder seguridad en validación (zod en aplicación).
// =============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export interface Database {
  public: {
    Tables: {
      [table: string]: {
        Row: AnyRow;
        Insert: AnyRow;
        Update: AnyRow;
        Relationships: [];
      };
    };
    Views: {
      [view: string]: { Row: AnyRow; Relationships: [] };
    };
    Functions: {
      [fn: string]: { Args: AnyRow; Returns: AnyRow };
    };
    Enums: { [name: string]: string };
    CompositeTypes: { [name: string]: AnyRow };
  };
}
