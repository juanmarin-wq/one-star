import "server-only"
import { prisma } from "../db/prisma"
import type { Gender, Prisma } from "@prisma/client"
import { buildProductVariantUpdatePlan } from "@/server/domain/product-variant-update.plan"
import { planProductColorFamilyUpdate } from "@/server/domain/product-color-family.plan"

const colorFamilyProductInclude = {
  brand: { select: { id: true, name: true } },
  images: { orderBy: { position: "asc" as const } },
  variants: true,
} as const

type ProductOrderBy =
  | Prisma.ProductOrderByWithRelationInput
  | Prisma.ProductOrderByWithRelationInput[]

export const productInclude = {
  category: true,
  brand: true,
  images: { orderBy: { position: "asc" as const } },
  variants: {
    include: {
      inventory: {
        include: { storeLocation: true }
      }
    }
  },
  colorFamily: {
    include: {
      products: { include: colorFamilyProductInclude, orderBy: { createdAt: "asc" as const } },
    },
  },
} as const

export async function findManyProducts(
  where?: Prisma.ProductWhereInput,
  orderBy?: ProductOrderBy,
  take?: number,
  skip?: number
) {
  return prisma.product.findMany({
    where,
    include: productInclude,
    take,
    skip,
    orderBy: orderBy ?? { createdAt: "desc" },
  })
}

export async function findProductCatalogCandidates(
  where: Prisma.ProductWhereInput,
  orderBy: ProductOrderBy
) {
  return prisma.product.findMany({
    where,
    orderBy,
    select: { id: true, colorFamilyId: true },
  })
}

export async function findProductsByIds(ids: readonly string[]) {
  if (ids.length === 0) return []
  return prisma.product.findMany({
    where: { id: { in: [...ids] }, isPublished: true },
    include: productInclude,
  })
}

export async function findProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, isPublished: true },
    include: {
      ...productInclude,
      crossSells: {
        where: { isPublished: true },
        include: {
          brand: { select: { id: true, name: true } },
          images: { take: 1, orderBy: { position: "asc" } },
          variants: true,
        },
      },
      colorFamily: {
        include: {
          products: { include: colorFamilyProductInclude, orderBy: { createdAt: "asc" } },
        },
      },
    },
  })
}

export async function findProductById(id: string) {
  return prisma.product.findUnique({ where: { id }, include: productInclude })
}

export async function findProductByIdForAdmin(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      brand: true,
      images: { orderBy: { position: "asc" } },
      variants: { 
        orderBy: { sku: "asc" },
        include: {
          inventory: {
            include: { storeLocation: true }
          }
        }
      },
      crossSells: {
        include: {
          brand: { select: { id: true, name: true } },
          images: { take: 1, orderBy: { position: "asc" } },
          variants: { 
            include: {
              inventory: { include: { storeLocation: true } }
            }
          },
        },
      },
      colorFamily: {
        include: {
          products: {
            include: colorFamilyProductInclude,
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  })
}

export async function countProducts(
  where?: Prisma.ProductWhereInput
): Promise<number> {
  return prisma.product.count({ where })
}

export async function fetchBrands(): Promise<string[]> {
  const brands = await prisma.brand.findMany({
    select: { name: true },
    where: {
      isActive: true,
      products: { some: { isPublished: true } },
    },
    orderBy: { name: "asc" }
  })
  return brands.map((b) => b.name)
}

export async function createProductRecord(data: Prisma.ProductCreateInput) {
  return prisma.product.create({ data, include: productInclude })
}

/**
 * Trae, para cada SKU dado, a qué producto pertenece su variante (id, slug y
 * erpId) y el estado actual de la variante. Usado por el importador de Excel
 * para decidir crear/actualizar/rechazar cada fila sin tocar productos que ya
 * gestiona el ERP.
 */
export async function findVariantsBySkus(skus: string[]) {
  if (skus.length === 0) return []
  return prisma.variant.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      size: true,
      color: true,
      stock: true,
      sizeUS: true,
      sizeCM: true,
      sizeEUR: true,
      product: { select: { id: true, slug: true, name: true, erpId: true } },
    },
  })
}

export async function updateProductRecord(
  id: string,
  data: Prisma.ProductUpdateInput
) {
  return prisma.product.update({ where: { id }, data, include: productInclude })
}

/**
 * Productos cargados a mano (sin `erpId`) — usado por el asistente de
 * conexión ERP para detectar posibles duplicados antes de la primera
 * sincronización real.
 */
export async function findManualProductNames() {
  return prisma.product.findMany({
    where: { erpId: null },
    select: { id: true, name: true, slug: true },
  })
}

/** Cambia el slug de un producto manual para que el sincronizador lo reconozca como el mismo del ERP. */
export async function updateProductSlug(id: string, slug: string) {
  return prisma.product.update({ where: { id }, data: { slug } })
}

export interface AdminProductRelationsUpdate {
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
  variants: Array<{
    sku: string
    size: string
    color: string
    stock: number
    inventory: Array<{ storeLocationId: string | null; stock: number }>
    sizeUS?: string | null
    sizeCM?: string | null
    sizeEUR?: string | null
  }>
  images: Array<{
    url: string
    alt?: string
    position?: number
    color?: string | null
  }>
  colorFamilyProductIds?: string[]
  colorFamilyBaselineProductIds?: string[]
  crossSellIds?: string[]
}

async function syncProductColorFamily(
  tx: Prisma.TransactionClient,
  productId: string,
  requestedMemberIds: readonly string[],
  expectedCurrentMemberIds?: readonly string[]
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('onestar-product-color-family'))`

  const current = await tx.product.findUnique({
    where: { id: productId },
    select: {
      colorFamilyId: true,
      colorFamily: { select: { products: { select: { id: true } } } },
    },
  })
  if (!current) throw new Error("El producto que intentas editar ya no existe.")

  const desiredIds = [productId, ...requestedMemberIds]
  const memberships = await tx.product.findMany({
    where: { id: { in: desiredIds } },
    select: {
      id: true,
      colorFamilyId: true,
      variants: { select: { color: true } },
    },
  })
  const plan = planProductColorFamilyUpdate({
    productId,
    currentFamilyId: current.colorFamilyId,
    currentMemberIds: current.colorFamily?.products.map((product) => product.id) ?? [productId],
    expectedCurrentMemberIds,
    requestedMemberIds,
    products: memberships.map((membership) => ({
      id: membership.id,
      colorFamilyId: membership.colorFamilyId,
      colors: membership.variants.map((variant) => variant.color),
    })),
  })

  if (!plan.success) {
    if (plan.error.code === "FOREIGN_FAMILY") {
      throw new Error(
        "Uno de los productos seleccionados ya pertenece a otra familia de colores. Retíralo de esa familia antes de relacionarlo."
      )
    }
    if (plan.error.code === "INVALID_COLOR") {
      throw new Error("Cada producto relacionado debe tener un color real en sus variantes.")
    }
    if (plan.error.code === "DUPLICATE_COLOR") {
      throw new Error("Cada producto de la familia debe representar un color diferente.")
    }
    if (plan.error.code === "STALE_FAMILY") {
      throw new Error(
        "Los colores relacionados cambiaron mientras editabas. Recarga el producto antes de guardar."
      )
    }
    throw new Error("Uno de los productos seleccionados ya no existe.")
  }

  if (plan.mode === "none") return

  if (plan.mode === "dissolve" && plan.familyId) {
    await tx.product.updateMany({
      where: { colorFamilyId: plan.familyId },
      data: { colorFamilyId: null },
    })
    await tx.productColorFamily.delete({ where: { id: plan.familyId } })
    return
  }

  if (plan.mode === "create") {
    const family = await tx.productColorFamily.create({ data: {} })
    await tx.product.updateMany({
      where: { id: { in: plan.memberIds } },
      data: { colorFamilyId: family.id },
    })
    return
  }

  if (plan.mode === "update" && plan.familyId) {
    // Toda edición explícita convierte la familia en manual. Así una futura
    // sincronización nunca revierte miembros agregados o retirados por admin.
    await tx.productColorFamily.update({
      where: { id: plan.familyId },
      data: { erpColorFamilyKey: null },
    })
    await tx.product.updateMany({
      where: {
        colorFamilyId: plan.familyId,
        id: { notIn: plan.memberIds },
      },
      data: { colorFamilyId: null },
    })
    await tx.product.updateMany({
      where: { id: { in: plan.memberIds } },
      data: { colorFamilyId: plan.familyId },
    })
  }
}

/**
 * Guarda la edición conservando la identidad y `erpId` de cada variante.
 * Las variantes de Loggro se actualizan en sitio; nunca se borran y recrean.
 */
export async function updateProductWithAdminRelations(
  id: string,
  input: AdminProductRelationsUpdate
) {
  return prisma.$transaction(async (tx) => {
    const existingVariants = await tx.variant.findMany({
      where: { productId: id },
      select: { id: true, sku: true, erpId: true, size: true, stock: true },
    })
    const variantPlan = buildProductVariantUpdatePlan(existingVariants, input.variants)
    if (!variantPlan.success) throw new Error(variantPlan.error.message)

    if (variantPlan.deleteIds.length > 0) {
      await tx.variant.deleteMany({ where: { id: { in: variantPlan.deleteIds } } })
    }

    for (const variant of variantPlan.updates) {
      await tx.variant.update({
        where: { id: variant.id },
        data: {
          size: variant.size,
          color: variant.color,
          stock: variant.stock,
          sizeUS: variant.sizeUS ?? null,
          sizeCM: variant.sizeCM ?? null,
          sizeEUR: variant.sizeEUR ?? null,
        },
      })
      // Solo se reemplazan las sedes que envió el formulario: el desglose que
      // escribe la sincronización ERP para otras sedes no se pierde al guardar.
      const submittedStoreIds = variant.inventory.flatMap((inventory) =>
        inventory.storeLocationId ? [inventory.storeLocationId] : []
      )
      const includesWebWarehouse = variant.inventory.some(
        (inventory) => inventory.storeLocationId === null
      )
      if (variant.inventory.length > 0) {
        await tx.inventoryLevel.deleteMany({
          where: {
            variantId: variant.id,
            OR: [
              ...(submittedStoreIds.length > 0
                ? [{ storeLocationId: { in: submittedStoreIds } }]
                : []),
              ...(includesWebWarehouse ? [{ storeLocationId: null }] : []),
            ],
          },
        })
        await tx.inventoryLevel.createMany({
          data: variant.inventory.map((inventory) => ({
            variantId: variant.id,
            storeLocationId: inventory.storeLocationId,
            stock: inventory.stock,
          })),
        })
      }
    }

    for (const variant of variantPlan.creates) {
      await tx.variant.create({
        data: {
          productId: id,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          stock: variant.stock,
          sizeUS: variant.sizeUS ?? null,
          sizeCM: variant.sizeCM ?? null,
          sizeEUR: variant.sizeEUR ?? null,
          inventory: {
            create: variant.inventory.map((inventory) => ({
              storeLocationId: inventory.storeLocationId,
              stock: inventory.stock,
            })),
          },
        },
      })
    }

    await tx.productImage.deleteMany({ where: { productId: id } })

    if (input.colorFamilyProductIds !== undefined) {
      await syncProductColorFamily(
        tx,
        id,
        input.colorFamilyProductIds,
        input.colorFamilyBaselineProductIds
      )
    }

    return tx.product.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        brand: input.brandId ? { connect: { id: input.brandId } } : { disconnect: true },
        gender: (input.gender as Gender) ?? null,
        category: { connect: { id: input.categoryId } },
        description: input.description ?? null,
        extendedDescription: input.extendedDescription ?? null,
        videoUrl: input.videoUrl ?? null,
        basePrice: input.basePrice,
        isOnSale: input.isOnSale,
        salePrice: input.salePrice ?? null,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
        availableOnline: input.availableOnline,
        availableInStores: input.availableInStores,
        isPublished: input.isPublished,
        images: {
          create: input.images.map((image, index) => ({
            url: image.url,
            alt: image.alt ?? input.name,
            position: image.position ?? index,
            color: image.color ?? null,
          })),
        },
        crossSells: {
          set: (input.crossSellIds ?? []).map((crossSellId) => ({ id: crossSellId })),
        },
      },
      include: {
        category: true,
        brand: true,
        images: { orderBy: { position: "asc" } },
        variants: {
          orderBy: { sku: "asc" },
          include: {
            inventory: { include: { storeLocation: true } },
          },
        },
        crossSells: {
          include: {
            brand: { select: { id: true, name: true } },
            images: { take: 1, orderBy: { position: "asc" } },
            variants: {
              include: { inventory: { include: { storeLocation: true } } },
            },
          },
        },
        colorFamily: {
          include: {
            products: { include: colorFamilyProductInclude, orderBy: { createdAt: "asc" } },
          },
        },
      },
    })
  })
}

export async function deleteProductRecord(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('onestar-product-color-family'))`
    const product = await tx.product.findUnique({
      where: { id },
      select: { colorFamilyId: true },
    })
    await tx.product.delete({ where: { id } })

    if (!product?.colorFamilyId) return
    const remaining = await tx.product.findMany({
      where: { colorFamilyId: product.colorFamilyId },
      select: { id: true },
    })
    if (remaining.length <= 1) {
      await tx.product.updateMany({
        where: { colorFamilyId: product.colorFamilyId },
        data: { colorFamilyId: null },
      })
      await tx.productColorFamily.delete({ where: { id: product.colorFamilyId } })
    }
  })
}

export async function deleteVariantsByProduct(productId: string) {
  return prisma.variant.deleteMany({ where: { productId } })
}

export async function deleteImagesByProduct(productId: string) {
  return prisma.productImage.deleteMany({ where: { productId } })
}

export async function searchProductsByName(
  q: string,
  excludeId?: string,
  take = 8
) {
  return prisma.product.findMany({
    where: {
      AND: [
        { name: { contains: q, mode: "insensitive" } },
        excludeId ? { id: { not: excludeId } } : {},
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      basePrice: true,
      colorFamilyId: true,
      brandId: true,
      brand: { select: { name: true } },
      images: { select: { url: true }, orderBy: { position: "asc" }, take: 2 },
      variants: { select: { color: true }, orderBy: { sku: "asc" }, take: 20 },
    },
    take,
  })
}

export async function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn)
}

export async function updateProductsPublishStatus(
  ids: string[],
  isPublished: boolean
) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.product.updateMany({
      where: { id: { in: ids } },
      data: { isPublished, updatedAt: new Date() },
    })
    if (result.count !== ids.length) {
      throw new Error("No se pudieron actualizar todos los productos seleccionados.")
    }
    return result
  })
}

/**
 * Slugs de los productos visibles en la vitrina, para el sitemap.
 * Se limita a lo publicado: es lo mismo que deja pasar `getProductBySlug`.
 */
export async function findPublishedProductSitemapEntries(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  return prisma.product.findMany({
    where: { isPublished: true },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  })
}
