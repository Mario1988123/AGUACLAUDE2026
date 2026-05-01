import { z } from "zod";
import {
  validateDNIorNIE,
  validateCIF,
  validateIBAN,
  validateSpanishPostalCode,
  validateSpanishPhone,
} from "./spanish";

export const taxIdSchema = z
  .string()
  .min(9)
  .refine((v) => validateDNIorNIE(v).valid || validateCIF(v), {
    message: "DNI/NIE/CIF no válido",
  });

export const ibanSchema = z.string().refine(validateIBAN, { message: "IBAN no válido" });

export const spanishPostalCodeSchema = z
  .string()
  .refine(validateSpanishPostalCode, { message: "Código postal español no válido" });

export const spanishPhoneSchema = z
  .string()
  .refine(validateSpanishPhone, { message: "Teléfono español no válido" });

export const emailSchema = z.string().email("Email no válido");
