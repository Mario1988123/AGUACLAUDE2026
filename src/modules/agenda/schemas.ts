import { z } from "zod";

export const AGENDA_KIND = [
  "visit",
  "installation",
  "maintenance",
  "call",
  "reminder",
  "manual",
  "incident_followup",
  "meeting",
] as const;

export const RECURRENCE_FREQ = ["none", "daily", "weekly", "monthly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQ)[number];

export const agendaCreateSchema = z.object({
  kind: z.enum(AGENDA_KIND).default("manual"),
  title: z.string().min(2, "Título obligatorio"),
  description: z.string().optional().default(""),
  starts_at: z.string().min(1, "Fecha/hora obligatoria"),
  ends_at: z.string().optional().default(""),
  all_day: z.coerce.boolean().default(false),
  assigned_user_id: z.string().uuid().optional(),
  subject_type: z.string().optional(),
  subject_id: z.string().uuid().optional(),
  reminders_min_before: z.array(z.number().int().min(0)).default([60]),
  recurrence_freq: z.enum(RECURRENCE_FREQ).default("none"),
  recurrence_count: z.coerce.number().int().min(1).max(52).default(1),
});
export type AgendaCreateInput = z.infer<typeof agendaCreateSchema>;
