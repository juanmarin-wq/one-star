import "server-only"

import { z } from "zod"

const yesNo = z.preprocess((v) => {
  const s = String(v ?? "").trim().toUpperCase()
  if (s === "SI" || s === "SÍ") return true
  if (s === "NO" || s === "") return undefined
  return v
}, z.boolean().optional())

const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url("URL inválida").optional()
)

export const GENDER_VALUES = ["UNISEX", "HOMBRE", "MUJER", "NINO", "NINA", "INFANTIL", "BEBE"] as const

/** Una fila cruda del Excel, tal como llega tras leer las celdas (índices 0-22, ver plantilla). */
export const productImportRowSchema = z.object({
  sku: z.string().trim().min(1, "SKU vacío"),
  name: z.string().trim().min(1, "Nombre del producto vacío"),
  brandName: z.string().trim().min(1, "Marca vacía"),
  categoryName: z.string().trim().min(1, "Categoría vacía"),
  gender: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : String(v).trim().toUpperCase()),
    z.enum(GENDER_VALUES).optional()
  ),
  price: z.coerce.number({ message: "Precio inválido" }).nonnegative("Precio no puede ser negativo"),
  isOnSale: yesNo,
  salePrice: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().nonnegative().optional()
  ),
  description: z.string().trim().optional(),
  extendedDescription: z.string().trim().optional(),
  size: z.string().trim().min(1, "Talla vacía"),
  sizeUS: z.string().trim().optional(),
  sizeCM: z.string().trim().optional(),
  sizeEUR: z.string().trim().optional(),
  color: z.string().trim().min(1, "Color vacío"),
  stock: z.coerce.number().int("Stock debe ser un entero").nonnegative("Stock no puede ser negativo"),
  image1: optionalUrl,
  image2: optionalUrl,
  image3: optionalUrl,
  videoUrl: optionalUrl,
  isPublished: yesNo,
  availableOnline: yesNo,
  availableInStores: yesNo,
}).refine(
  (data) => !data.isOnSale || data.salePrice !== undefined,
  { message: "Precio de oferta requerido cuando ¿En oferta? = SI", path: ["salePrice"] }
)

export type ProductImportRow = z.infer<typeof productImportRowSchema>
