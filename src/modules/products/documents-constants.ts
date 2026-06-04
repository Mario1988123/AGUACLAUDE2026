/**
 * Constantes del módulo de documentos (separadas de documents-actions.ts
 * porque un archivo "use server" solo puede exportar funciones async).
 */

export type ProductDocKind =
  | "manual_user"
  | "manual_installer"
  | "manufacturer_datasheet"
  | "certificate"
  | "warranty_card"
  | "compliance_doc"
  | "spare_parts_list"
  | "other";

export const PRODUCT_DOC_KIND_LABEL: Record<ProductDocKind, string> = {
  manual_user: "Manual de usuario",
  manual_installer: "Manual del instalador",
  manufacturer_datasheet: "Ficha técnica fabricante",
  certificate: "Certificado",
  warranty_card: "Tarjeta de garantía",
  compliance_doc: "Documento de cumplimiento",
  spare_parts_list: "Lista de recambios",
  other: "Otro",
};
