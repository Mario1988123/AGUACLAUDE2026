import type { PRODUCT_KIND } from "./schemas";

export type ProductKind = (typeof PRODUCT_KIND)[number];

export interface ProductListItem {
  id: string;
  name: string;
  kind: ProductKind;
  category_id: string | null;
  category_name: string | null;
  internal_reference: string | null;
  is_active: boolean;
  main_image_url: string | null;
  cash_price_cents: number | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  kind: ProductKind;
  category_id: string | null;
  internal_reference: string | null;
  supplier_reference: string | null;
  short_description: string | null;
  long_description: string | null;
  is_active: boolean;
  cost_cents: number | null;
  supplier_price_cents: number | null;
  dim_width_mm: number | null;
  dim_height_mm: number | null;
  dim_depth_mm: number | null;
  weight_grams: number | null;
  stock_managed: boolean;
  stock_min: number;
  main_image_url: string | null;
  notes: string | null;
}

export interface CategoryItem {
  id: string;
  name: string;
  default_kind: ProductKind;
  sort_order: number;
  is_active: boolean;
  cloned_from_global_id: string | null;
}
