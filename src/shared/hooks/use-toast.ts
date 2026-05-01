"use client";

import { toast } from "sonner";

/**
 * Wrapper unificado del sistema de toast. Cuatro variantes alineadas a los
 * colores corporativos: success/error/warning/info.
 */
export const notify = {
  success: (msg: string, description?: string) => toast.success(msg, { description }),
  error: (msg: string, description?: string) => toast.error(msg, { description }),
  warning: (msg: string, description?: string) => toast.warning(msg, { description }),
  info: (msg: string, description?: string) => toast.info(msg, { description }),
};
