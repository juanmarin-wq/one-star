import "server-only"
import { serializeDecimals, type WithPlainDecimals } from "@/lib/serialize-decimals"
import {
  findManyProducts,
  findProductCatalogCandidates,
  findProductsByIds,
  findProductBySlug,
  findProductByIdForAdmin,
  findPublishedProductSitemapEntries,
  countProducts,
  fetchBrands,
  deleteProductRecord,
  searchProductsByName,
  updateProductWithAdminRelations,
  updateProductsPublishStatus as repoUpdateProductsPublishStatus,
} from "../repositories/product.repository"
import type { Prisma, Gender } from "@prisma/client"
import { resolveGenderFilter } from "@/lib/gender-filter"
import { resolveProductSort, type ProductSortValue } from "@/lib/product-sort"
import { buildVisibleProductPage } from "@/server/domain/product-color-family.plan"

export interface CategoryDTO {
  id: string
  name: string
  slug: string
}

export interface ProductImageDTO {
  id: string
  url: string
  alt: string
  position: number
  /** Color de variante al que pertenece la foto. null = imagen general. */
  color: string | null
}

/**
 * Datos de la sede dueña de un nivel de inventario. La ficha de producto los
 * necesita completos para dibujar el mapa de disponibilidad, no solo el nombre.
 */
export interface InventoryStoreDTO {
  id: string
  name: string
  address: string
  city: string
  phone: string | null
  schedule: string | null
  googleMapsUrl: string | null
  latitude: number | null
  longitude: number | null
  isWebWarehouse: boolean
  isActive: boolean
}

export interface InventoryLevelDTO {
  id: string
  storeLocationId: string | null
  storeName: string | null
  /** `null` cuando el nivel corresponde a la bodega web (sin sede física). */
  storeLocation: InventoryStoreDTO | null
  stock: number
}

export interface VariantDTO {
  id: string
  sku: string
  size: string
  color: string
  stock: number // Virtual Store Stock
  inventory: InventoryLevelDTO[]
  sizeUS: string | null
  sizeCM: string | null
  sizeEUR: string | null
}

export interface CrossSellDTO {
  id: string
  slug: string
  name: string
  brandId: string | null
  brandName: string | null
  brand: string | null
  basePrice: number
  isOnSale: boolean
  salePrice: number | null
  images: ProductImageDTO[]
  variants: VariantDTO[]
}

export type ColorSiblingDTO = CrossSellDTO

export interface ProductDTO {
  id: string
  slug: string
  name: string
  /** null = producto cargado manualmente (admin/Excel); presente = lo trae y gestiona el ERP. */
  erpId: string | null
  brandId: string | null
  brandName: string | null
  /** Nombre de la marca (alias plano de brandName para la UI de la tienda) */
  brand: string | null
  basePrice: number
  isOnSale: boolean
  salePrice: number | null
  description: string | null
  extendedDescription: string | null
  videoUrl: string | null
  metaTitle: string | null
  metaDescription: string | null
  gender: string | null
  categoryId: string
  category: CategoryDTO
  availableOnline: boolean
  availableInStores: boolean
  isPublished: boolean
  images: ProductImageDTO[]
  variants: VariantDTO[]
  colorSiblings: ColorSiblingDTO[]
  crossSells: CrossSellDTO[]
  hasStock: boolean
  isNew: boolean
  createdAt: string
  updatedAt: string
}

export interface AppProductFilter {
  q?: string
  marca?: string
  talla?: string
  color?: string
  precio_min?: string
  precio_max?: string
  orden?: ProductSortValue
  page?: string
  genero?: string
  categorySlug?: string
  categoryId?: string
  brandId?: string
  isOnSaleOnly?: boolean
  extraGenders?: string[]
  status?: "active" | "inactive"
  hasStock?: "yes" | "no"
}

/**
 * Hombre y Mujer son secciones por género, no categorías de mercancía.
 * Un producto UNISEX pertenece a ambas; el resto de slugs conserva el filtro
 * normal por categoría.
 */
export function getCategorySectionProductFilter(
  slug: string
): Pick<AppProductFilter, "categorySlug" | "extraGenders"> {
  if (slug === "hombre") return { extraGenders: ["HOMBRE", "UNISEX"] }
  if (slug === "mujer") return { extraGenders: ["MUJER", "UNISEX"] }
  if (slug === "ninos") {
    return { extraGenders: ["NINO", "NINA", "INFANTIL", "BEBE"] }
  }
  return { categorySlug: slug }
}

export interface VariantInput {
  sku: string
  size: string
  color: string
  stock: number
  inventory: Array<{
    storeLocationId: string | null
    stock: number
  }>
  sizeUS?: string | null
  sizeCM?: string | null
  sizeEUR?: string | null
}

export interface ImageInput {
  url: string
  alt?: string
  position?: number
  color?: string | null
}

export interface ProductInput {
  name: string
  slug: string
  brandId?: string | null
  gender?: string | null
  categoryId: string
  description?: string | null
  extendedDescription?: string | null
  videoUrl?: string | null
  basePrice: number
  isOnSale: boolean
  salePrice?: number | null
  metaTitle?: string | null
  metaDescription?: string | null
  availableOnline: boolean
  availableInStores: boolean
  isPublished: boolean
  variants: VariantInput[]
  images: ImageInput[]
  colorFamilyProductIds?: string[]
  colorFamilyBaselineProductIds?: string[]
  crossSellIds?: string[]
}

type RawVariant = {
  id: string
  sku: string
  size: string
  color: string
  stock: number
  sizeUS: string | null
  sizeCM: string | null
  sizeEUR: string | null
  inventory?: Array<{
    id: string
    storeLocationId: string | null
    stock: number
    storeLocation?: InventoryStoreDTO | null
  }>
}

type RawImage = { id: string; url: string; alt: string; position: number; color?: string | null }

type RawPrice = { toNumber: () => number }

type RawRelatedProduct = {
  id: string
  slug: string
  name: string
  brandId: string | null
  brand: { id: string; name: string } | null
  basePrice: RawPrice
  isOnSale: boolean
  salePrice: RawPrice | null
  availableOnline?: boolean
  isPublished?: boolean
  images: RawImage[]
  variants: RawVariant[]
}

type RawProduct = {
  id: string
  slug: string
  name: string
  erpId?: string | null
  brandId: string | null
  brand: { id: string; name: string; slug: string } | null
  basePrice: RawPrice
  isOnSale: boolean
  salePrice: RawPrice | null
  description: string | null
  extendedDescription?: string | null
  videoUrl?: string | null
  metaTitle?: string | null
  metaDescription?: string | null
  gender?: string | null
  categoryId: string
  category: { id: string; name: string; slug: string }
  availableOnline?: boolean
  availableInStores?: boolean
  isPublished?: boolean
  images: RawImage[]
  variants: RawVariant[]
  colorFamily?: { products: RawRelatedProduct[] } | null
  crossSells?: RawRelatedProduct[]
  createdAt: Date
  updatedAt: Date
}

function mapImage(img: RawImage): ProductImageDTO {
  return {
    id: img.id,
    url: img.url,
    alt: img.alt,
    position: img.position,
    color: img.color ?? null,
  }
}

function mapVariant(v: RawVariant): VariantDTO {
  const inventory = (v.inventory ?? []).map(inv => ({
    id: inv.id,
    storeLocationId: inv.storeLocationId,
    storeName: inv.storeLocation?.name ?? null,
    storeLocation: inv.storeLocation ?? null,
    stock: inv.stock
  }))
  
  return {
    id: v.id,
    sku: v.sku,
    size: v.size,
    color: v.color,
    stock: v.stock,
    inventory,
    sizeUS: v.sizeUS ?? null,
    sizeCM: v.sizeCM ?? null,
    sizeEUR: v.sizeEUR ?? null,
  }
}

function mapRelatedProduct(raw: RawRelatedProduct): CrossSellDTO {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    brandId: raw.brandId ?? null,
    brandName: raw.brand?.name ?? null,
    brand: raw.brand?.name ?? null,
    basePrice: raw.basePrice.toNumber(),
    isOnSale: raw.isOnSale,
    salePrice: raw.salePrice ? raw.salePrice.toNumber() : null,
    images: raw.images.map(mapImage),
    variants: raw.variants.map(mapVariant),
  }
}

function mapToDTO(raw: RawProduct): ProductDTO {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    erpId: raw.erpId ?? null,
    brandId: raw.brandId ?? null,
    brandName: raw.brand?.name ?? null,
    brand: raw.brand?.name ?? null,
    basePrice: raw.basePrice.toNumber(),
    isOnSale: raw.isOnSale,
    salePrice: raw.salePrice ? raw.salePrice.toNumber() : null,
    description: raw.description ?? null,
    extendedDescription: raw.extendedDescription ?? null,
    videoUrl: raw.videoUrl ?? null,
    metaTitle: raw.metaTitle ?? null,
    metaDescription: raw.metaDescription ?? null,
    gender: raw.gender ?? null,
    categoryId: raw.categoryId,
    category: {
      id: raw.category.id,
      name: raw.category.name,
      slug: raw.category.slug,
    },
    availableOnline: raw.availableOnline ?? true,
    availableInStores: raw.availableInStores ?? true,
    isPublished: raw.isPublished ?? true,
    images: raw.images.map(mapImage),
    variants: raw.variants.map(mapVariant),
    colorSiblings: (raw.colorFamily?.products ?? [])
      .filter((product) => product.id !== raw.id && product.isPublished !== false)
      .map(mapRelatedProduct),
    crossSells: (raw.crossSells ?? []).map(mapRelatedProduct),
    hasStock: raw.variants.reduce((acc, v) => acc + (v.stock || 0), 0) > 0,
    isNew: raw.createdAt > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Created in last 30 days
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  }
}

function buildPrismaWhere(
  filter: AppProductFilter
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {}

  if (filter.isOnSaleOnly) where.isOnSale = true
  if (filter.categorySlug) where.category = { slug: filter.categorySlug }
  if (filter.categoryId) where.categoryId = filter.categoryId
  if (filter.brandId) where.brandId = filter.brandId
  if (filter.status === "active") where.isPublished = true
  if (filter.status === "inactive") where.isPublished = false

  // La sección (/c/hombre, /c/mujer, /c/ninos) fija extraGenders; el visitante puede
  // acotar más con ?genero=. Dentro de una sección, el filtro solo puede restringir.
  const sectionGenders = filter.extraGenders && filter.extraGenders.length > 0 ? filter.extraGenders : null
  const requestedGenders = resolveGenderFilter(filter.genero)
  const genders =
    sectionGenders && requestedGenders
      ? requestedGenders.filter((g) => sectionGenders.includes(g))
      : (requestedGenders ?? sectionGenders)
  if (genders) {
    where.gender = { in: genders as Gender[] }
  }

  if (filter.q) where.name = { contains: filter.q, mode: "insensitive" }
  if (filter.marca) where.brand = { is: { name: { contains: filter.marca, mode: "insensitive" } } }

  const hasMin = filter.precio_min && !isNaN(Number(filter.precio_min))
  const hasMax = filter.precio_max && !isNaN(Number(filter.precio_max))
  if (hasMin || hasMax) {
    where.basePrice = {
      ...(hasMin ? { gte: Number(filter.precio_min) } : {}),
      ...(hasMax ? { lte: Number(filter.precio_max) } : {}),
    }
  }

  const matchingVariant: Prisma.VariantWhereInput = {}
  if (filter.hasStock === "yes") matchingVariant.stock = { gt: 0 }
  if (filter.talla) matchingVariant.size = filter.talla
  if (filter.color) {
    matchingVariant.color = { contains: filter.color, mode: "insensitive" }
  }

  const hasVariantCriteria = Object.keys(matchingVariant).length > 0
  if (filter.hasStock === "no") {
    const noPositiveStock: Prisma.ProductWhereInput = {
      variants: { none: { stock: { gt: 0 } } },
    }
    if (hasVariantCriteria) {
      where.AND = [
        noPositiveStock,
        { variants: { some: matchingVariant } },
      ]
    } else {
      where.variants = noPositiveStock.variants
    }
  } else if (hasVariantCriteria) {
    where.variants = { some: matchingVariant }
  }

  return where
}

function buildPrismaOrderBy(
  orden?: string
): Prisma.ProductOrderByWithRelationInput[] {
  // Un criterio desconocido cae al orden por defecto en vez de romper la consulta.
  switch (resolveProductSort(orden)) {
    case "precio_asc":
      return [{ basePrice: "asc" }, { id: "asc" }]
    case "precio_desc":
      return [{ basePrice: "desc" }, { id: "asc" }]
    case "az":
      return [{ name: "asc" }, { id: "asc" }]
    case "za":
      return [{ name: "desc" }, { id: "asc" }]
    case "antiguo":
      return [{ createdAt: "asc" }, { id: "asc" }]
    default:
      return [{ createdAt: "desc" }, { id: "asc" }]
  }
}

export async function getProducts(
  filter: AppProductFilter,
  pageSize = 24
): Promise<{ products: ProductDTO[]; total: number }> {
  const page = Math.max(1, Number(filter.page ?? 1))
  const where = { ...buildPrismaWhere(filter), isPublished: true }
  const orderBy = buildPrismaOrderBy(filter.orden)
  const candidates = await findProductCatalogCandidates(where, orderBy)
  const visiblePage = buildVisibleProductPage(candidates, page, pageSize)
  const rows = await findProductsByIds(visiblePage.productIds)
  const rowsById = new Map(rows.map((row) => [row.id, row]))

  return {
    products: visiblePage.productIds.flatMap((id) => {
      const row = rowsById.get(id)
      return row ? [mapToDTO(row)] : []
    }),
    total: visiblePage.total,
  }
}

/**
 * El administrador trabaja con los registros ERP individuales. Por eso esta
 * consulta no colapsa las familias de color como sí lo hace el catálogo.
 */
export async function getAdminProducts(
  filter: AppProductFilter,
  pageSize = 20
): Promise<{ products: ProductDTO[]; total: number }> {
  const page = Math.max(1, Number(filter.page ?? 1))
  const where = buildPrismaWhere(filter)
  const orderBy = buildPrismaOrderBy(filter.orden)
  const [rows, total] = await Promise.all([
    findManyProducts(where, orderBy, pageSize, (page - 1) * pageSize),
    countProducts(where),
  ])

  return { products: rows.map(mapToDTO), total }
}

export async function getProductBySlug(slug: string): Promise<ProductDTO | null> {
  const raw = await findProductBySlug(slug)
  return raw && raw.isPublished !== false ? mapToDTO(raw) : null
}

export async function getTotalProductsCount(): Promise<number> {
  return countProducts()
}

export async function getUniqueBrands(): Promise<string[]> {
  return fetchBrands()
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<ProductDTO> {
  const raw = await updateProductWithAdminRelations(id, input)
  return mapToDTO(raw)
}

/** Detalle para el admin con los Decimal ya convertidos a number (cruza a Client Components). */
export type AdminProductDetail = WithPlainDecimals<Awaited<ReturnType<typeof findProductByIdForAdmin>>>

export async function getProductByIdForAdmin(id: string): Promise<AdminProductDetail> {
  const product = await findProductByIdForAdmin(id)
  return serializeDecimals(product)
}

export async function deleteProduct(id: string): Promise<void> {
  await deleteProductRecord(id)
}

export async function updateProductsPublishStatus(
  ids: string[],
  isPublished: boolean
): Promise<number> {
  const result = await repoUpdateProductsPublishStatus(ids, isPublished)
  if (result.count !== ids.length) {
    throw new Error("No se pudieron actualizar todos los productos seleccionados.")
  }
  return result.count
}

export async function getRelatedProducts(
  categoryId: string,
  excludeSlug: string,
  take = 4
): Promise<ProductDTO[]> {
  const rows = await findManyProducts(
    { categoryId, isPublished: true, NOT: { slug: excludeSlug } },
    { createdAt: "desc" },
    take,
    0
  )
  return rows.map(mapToDTO)
}

export async function searchProducts(
  q: string,
  excludeId?: string
): Promise<Array<{
  id: string
  slug: string
  name: string
  brandId: string | null
  brandName: string | null
  colorFamilyId: string | null
  imageUrl: string | null
  color: string | null
}>> {
  const rows = await searchProductsByName(q, excludeId)
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    brandId: row.brandId,
    brandName: row.brand?.name ?? null,
    colorFamilyId: row.colorFamilyId,
    imageUrl: row.images[0]?.url ?? null,
    color: row.variants.find((variant) => variant.color.trim().length > 0)?.color ?? null,
  }))
}

export interface ProductSitemapEntry {
  slug: string
  updatedAt: Date
}

/** Entradas de producto para `src/app/sitemap.ts`. */
export async function getProductSitemapEntries(): Promise<ProductSitemapEntry[]> {
  return findPublishedProductSitemapEntries()
}
