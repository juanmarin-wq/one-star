import "server-only"

import crypto from "node:crypto"
import * as XLSX from "xlsx"
import type { Gender, Prisma } from "@prisma/client"

import { slugify } from "@/lib/utils"
import { prisma } from "@/server/db/prisma"
import { findManyCategories } from "@/server/repositories/category.repository"
import { findManyBrands } from "@/server/repositories/brand.repository"
import { findVariantsBySkus } from "@/server/repositories/product.repository"
import { productImportRowSchema, type ProductImportRow } from "@/server/validators/product-import.validator"

type TxClient = Prisma.TransactionClient

const TEMPLATE_COLUMNS = [
  "sku", "name", "brandName", "categoryName", "gender", "price", "isOnSale", "salePrice",
  "description", "extendedDescription", "size", "sizeUS", "sizeCM", "sizeEUR", "color", "stock",
  "image1", "image2", "image3", "videoUrl", "isPublished", "availableOnline", "availableInStores",
] as const

const FIRST_DATA_ROW_INDEX = 2 // fila 1 = headers, fila 2 = notas de ayuda (ver plantilla)

function normalizeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

export interface ProductImportRowResult {
  rowNumber: number
  sku: string
  productName: string
  action: "create_product" | "add_variant" | "update_variant" | "error"
  message: string
}

export interface ProductImportPreview {
  fingerprint: string
  rows: ProductImportRowResult[]
  summary: { newProducts: number; newVariants: number; updatedVariants: number; errors: number }
}

interface PlannedVariant {
  row: ProductImportRow
  rowNumber: number
  kind: "create" | "update"
  existingVariantId?: string
}

interface PlannedGroup {
  groupKey: string
  name: string
  brandName: string
  categoryName: string
  existingProductId: string | null
  variants: PlannedVariant[]
}

function parseWorkbook(buffer: ArrayBuffer): { row: unknown[]; rowNumber: number }[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
  return raw
    .slice(FIRST_DATA_ROW_INDEX)
    .map((row, i) => ({ row, rowNumber: FIRST_DATA_ROW_INDEX + i + 1 }))
    .filter(({ row }) => row.some((cell) => String(cell ?? "").trim().length > 0))
}

function rowArrayToObject(row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  TEMPLATE_COLUMNS.forEach((key, idx) => {
    obj[key] = row[idx] ?? ""
  })
  return obj
}

/**
 * Parsea y planea la importación completa: agrupa filas por producto,
 * resuelve categoría/marca por nombre, y decide para cada fila si crea un
 * producto, agrega una variante o actualiza una existente — sin escribir
 * nada. `previewProductImport` y `applyProductImport` comparten esta función
 * para garantizar que el plan aplicado sea exactamente el que se mostró.
 */
async function planImport(buffer: ArrayBuffer): Promise<{
  rowResults: ProductImportRowResult[]
  groups: PlannedGroup[]
  fingerprint: string
}> {
  const rawRows = parseWorkbook(buffer)
  const rowResults: ProductImportRowResult[] = []
  const validRows: { row: ProductImportRow; rowNumber: number }[] = []
  const seenSkus = new Set<string>()

  for (const { row, rowNumber } of rawRows) {
    const parsed = productImportRowSchema.safeParse(rowArrayToObject(row))
    if (!parsed.success) {
      rowResults.push({
        rowNumber,
        sku: String(row[0] ?? "").trim(),
        productName: String(row[1] ?? "").trim(),
        action: "error",
        message: parsed.error.issues[0]?.message ?? "Fila inválida",
      })
      continue
    }
    const data = parsed.data
    if (seenSkus.has(data.sku)) {
      rowResults.push({
        rowNumber,
        sku: data.sku,
        productName: data.name,
        action: "error",
        message: "SKU duplicado en el archivo",
      })
      continue
    }
    seenSkus.add(data.sku)
    validRows.push({ row: data, rowNumber })
  }

  const skus = validRows.map((r) => r.row.sku)
  const [existingVariants, categories, brands] = await Promise.all([
    findVariantsBySkus(skus),
    findManyCategories(),
    findManyBrands(),
  ])
  const existingBySku = new Map(existingVariants.map((v) => [v.sku, v]))

  const groups = new Map<string, PlannedGroup>()

  for (const { row, rowNumber } of validRows) {
    const existing = existingBySku.get(row.sku)
    if (existing && existing.product.erpId !== null) {
      rowResults.push({
        rowNumber,
        sku: row.sku,
        productName: row.name,
        action: "error",
        message: `Gestionado por ERP (producto "${existing.product.name}") — no se puede modificar aquí`,
      })
      continue
    }

    const groupKey = [row.name, row.brandName, row.categoryName].map(normalizeKey).join("|")
    let group = groups.get(groupKey)
    if (!group) {
      group = {
        groupKey,
        name: row.name,
        brandName: row.brandName,
        categoryName: row.categoryName,
        existingProductId: existing ? existing.product.id : null,
        variants: [],
      }
      groups.set(groupKey, group)
    } else if (existing && group.existingProductId && existing.product.id !== group.existingProductId) {
      rowResults.push({
        rowNumber,
        sku: row.sku,
        productName: row.name,
        action: "error",
        message: "Este grupo de filas apunta a más de un producto existente distinto — revisa el SKU",
      })
      continue
    } else if (existing && !group.existingProductId) {
      group.existingProductId = existing.product.id
    }

    const plannedVariant: PlannedVariant = existing
      ? { row, rowNumber, kind: "update", existingVariantId: existing.id }
      : { row, rowNumber, kind: "create" }
    group.variants.push(plannedVariant)
  }

  for (const group of groups.values()) {
    let productAlreadyPlanned = group.existingProductId !== null
    for (const v of group.variants) {
      const action =
        v.kind === "update"
          ? "update_variant"
          : productAlreadyPlanned
            ? "add_variant"
            : "create_product"
      rowResults.push({
        rowNumber: v.rowNumber,
        sku: v.row.sku,
        productName: v.row.name,
        action,
        message:
          v.kind === "update"
            ? "Se actualiza talla/color/stock de la variante existente"
            : productAlreadyPlanned
              ? "Se agrega como variante nueva del producto existente"
              : "Se crea como producto nuevo",
      })
      if (v.kind === "create") productAlreadyPlanned = true
    }
  }

  const categoryNames = categories.map((c) => normalizeKey(c.name)).sort()
  const brandNames = brands.map((b) => normalizeKey(b.name)).sort()
  const fingerprintPayload = {
    variants: existingVariants
      .map((v) => ({
        sku: v.sku,
        productId: v.product.id,
        erpId: v.product.erpId,
        size: v.size,
        color: v.color,
        stock: v.stock,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
    categoryNames,
    brandNames,
  }
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(fingerprintPayload))
    .digest("hex")

  return { rowResults, groups: [...groups.values()], fingerprint }
}

export async function previewProductImport(buffer: ArrayBuffer): Promise<ProductImportPreview> {
  const { rowResults, fingerprint } = await planImport(buffer)
  const summary = rowResults.reduce(
    (acc, r) => {
      if (r.action === "create_product") acc.newProducts++
      else if (r.action === "add_variant") acc.newVariants++
      else if (r.action === "update_variant") acc.updatedVariants++
      else acc.errors++
      return acc
    },
    { newProducts: 0, newVariants: 0, updatedVariants: 0, errors: 0 }
  )
  return { fingerprint, rows: rowResults.sort((a, b) => a.rowNumber - b.rowNumber), summary }
}

async function resolveCategoryId(
  tx: TxClient,
  name: string,
  existing: { id: string; name: string }[],
  cache: Map<string, string>
): Promise<string> {
  const key = normalizeKey(name)
  const cached = cache.get(key)
  if (cached) return cached
  const found = existing.find((c) => normalizeKey(c.name) === key)
  if (found) {
    cache.set(key, found.id)
    return found.id
  }
  // Mismo patrón que ensureCatalogCategory, pero dentro de la transacción de
  // la importación: si algo falla después, la categoría nueva no debe quedar
  // huérfana sin el producto que la necesitaba.
  const slug = slugify(name)
  const created = await tx.category.upsert({
    where: { slug },
    update: {},
    create: { slug, name, description: `Categoría creada al importar productos desde Excel: ${name}` },
  })
  cache.set(key, created.id)
  return created.id
}

async function resolveBrandId(
  tx: TxClient,
  name: string,
  existing: { id: string; name: string }[],
  cache: Map<string, string>
): Promise<string> {
  const key = normalizeKey(name)
  const cached = cache.get(key)
  if (cached) return cached
  const found = existing.find((b) => normalizeKey(b.name) === key)
  if (found) {
    cache.set(key, found.id)
    return found.id
  }
  const slug = slugify(name)
  const created = await tx.brand.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
  })
  cache.set(key, created.id)
  return created.id
}

async function uniqueSlug(tx: TxClient, base: string): Promise<string> {
  let candidate = base
  let suffix = 2
  while (await tx.product.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`
    suffix++
  }
  return candidate
}

export interface ProductImportApplyResult {
  newProducts: number
  newVariants: number
  updatedVariants: number
}

export async function applyProductImport(
  buffer: ArrayBuffer,
  expectedFingerprint: string
): Promise<ProductImportApplyResult> {
  const { groups, fingerprint } = await planImport(buffer)
  if (fingerprint !== expectedFingerprint) {
    throw new Error(
      "El catálogo cambió desde que generaste la vista previa. Vuelve a subir el archivo para revisar los cambios."
    )
  }

  const categories = await findManyCategories()
  const brands = await findManyBrands()
  const categoryCache = new Map<string, string>()
  const brandCache = new Map<string, string>()

  let newProducts = 0
  let newVariants = 0
  let updatedVariants = 0

  await prisma.$transaction(async (tx) => {
    for (const group of groups) {
      let productId = group.existingProductId

      if (!productId) {
        // Solo al crear un producto nuevo se necesita (y se crea si falta) su
        // categoría y marca; las filas que solo actualizan no deben dejarlas huérfanas.
        const categoryId = await resolveCategoryId(tx, group.categoryName, categories, categoryCache)
        const brandId = await resolveBrandId(tx, group.brandName, brands, brandCache)
        const first = group.variants.find((v) => v.kind === "create")!.row
        const slug = await uniqueSlug(tx, slugify(group.name))
        const images: Prisma.ProductImageCreateWithoutProductInput[] = []
        const seenUrls = new Set<string>()
        for (const v of group.variants) {
          for (const url of [v.row.image1, v.row.image2, v.row.image3]) {
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url)
              images.push({ url, alt: group.name, position: images.length, color: v.row.color })
            }
          }
        }
        const created = await tx.product.create({
          data: {
            name: group.name,
            slug,
            basePrice: first.price,
            isOnSale: first.isOnSale ?? false,
            salePrice: first.isOnSale ? (first.salePrice ?? null) : null,
            description: first.description ?? null,
            extendedDescription: first.extendedDescription ?? null,
            videoUrl: first.videoUrl ?? null,
            gender: (first.gender as Gender | undefined) ?? null,
            category: { connect: { id: categoryId } },
            brand: { connect: { id: brandId } },
            isPublished: first.isPublished ?? true,
            availableOnline: first.availableOnline ?? true,
            availableInStores: first.availableInStores ?? true,
            images: { create: images },
          },
        })
        productId = created.id
        newProducts++
      }

      if (group.existingProductId) {
        // Variantes nuevas de un producto que ya existe: sus fotos se agregan
        // a la galería (sin repetir URLs que el producto ya tiene).
        const current = await tx.productImage.findMany({
          where: { productId: group.existingProductId },
          select: { url: true },
        })
        const seen = new Set(current.map((i) => i.url))
        let position = current.length
        const extra: Prisma.ProductImageCreateManyInput[] = []
        for (const v of group.variants) {
          if (v.kind !== "create") continue
          for (const url of [v.row.image1, v.row.image2, v.row.image3]) {
            if (url && !seen.has(url)) {
              seen.add(url)
              extra.push({
                productId: group.existingProductId,
                url,
                alt: group.name,
                position: position++,
                color: v.row.color,
              })
            }
          }
        }
        if (extra.length > 0) await tx.productImage.createMany({ data: extra })
      }

      for (const v of group.variants) {
        if (v.kind === "update" && v.existingVariantId) {
          await tx.variant.update({
            where: { id: v.existingVariantId },
            data: {
              size: v.row.size,
              color: v.row.color,
              stock: v.row.stock,
              sizeUS: v.row.sizeUS ?? null,
              sizeCM: v.row.sizeCM ?? null,
              sizeEUR: v.row.sizeEUR ?? null,
            },
          })
          updatedVariants++
        } else {
          await tx.variant.create({
            data: {
              productId,
              sku: v.row.sku,
              size: v.row.size,
              color: v.row.color,
              stock: v.row.stock,
              sizeUS: v.row.sizeUS ?? null,
              sizeCM: v.row.sizeCM ?? null,
              sizeEUR: v.row.sizeEUR ?? null,
            },
          })
          newVariants++
        }
      }
    }
  }, { timeout: 120_000, maxWait: 10_000 })

  return { newProducts, newVariants, updatedVariants }
}
