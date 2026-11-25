import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Hidromanager"),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // 32 bytes en hex (64 chars).
  // Genera con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Se usa para cifrar/descifrar contraseñas SMTP guardadas en
  // companies.smtp_*_password_enc y email_user_settings.smtp_password_enc.
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY debe ser 64 caracteres hex (32 bytes)")
    .optional(),
  // Resend (proveedor de email opt-in por empresa). Cuenta única de plataforma.
  // RESEND_API_KEY: envío. RESEND_WEBHOOK_SECRET: verificación svix del webhook
  // de tracking (/api/webhooks/resend). Ambas opcionales: sin ellas, las
  // empresas en modo 'resend' caen a SMTP.
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  // Captación WhatsApp (app de Meta de Vercomi, Tech Provider). Todas
  // opcionales: sin ellas el módulo enseña «sin configurar» y no conecta.
  // META_APP_SECRET firma los webhooks; sin él /api/webhooks/whatsapp no
  // acepta nada. CAPTACION_ENVIOS_ACTIVOS=1 es la tercera llave del frío.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_CONFIG_ID: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
  CAPTACION_ENVIOS_ACTIVOS: z.string().optional(),
  // Google Places (complemento de OSM en captación). Clave de SERVIDOR,
  // restringida a «Places API (New)» en el proyecto aguaclaude. Tope mensual
  // de todas las empresas: PLACES_TOPE_MENSUAL (por defecto y máximo, 1.000).
  GOOGLE_PLACES_SERVER_KEY: z.string().optional(),
  PLACES_TOPE_MENSUAL: z.string().optional(),
});

export const publicEnv = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});

export const serverEnv = () =>
  serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_CONFIG_ID: process.env.META_CONFIG_ID,
    META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || undefined,
    CAPTACION_ENVIOS_ACTIVOS: process.env.CAPTACION_ENVIOS_ACTIVOS,
  });
