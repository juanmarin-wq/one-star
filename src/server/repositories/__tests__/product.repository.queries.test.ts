import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const m = vi.hoisted(() => ({
  product: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  variant: { deleteMany: vi.fn(), findMany: vi.fn() },
  productImage: { deleteMany: vi.fn() },
}))

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  product: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
  },
  productColorFamily: { delete: vi.fn() },
}))

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    product: m.product,
    variant: m.variant,
    productImage: m.productImage,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) =>
      typeof fn === "function" ? fn(tx) : fn
    ),
  },
}))

import {
  countProducts,
  createProductRecord,
  deleteImagesByProduct,
  deleteProductRecord,
  deleteVariantsByProduct,
  findManyProducts,
  findProductById,
  findProductByIdForAdmin,
  findProductCatalogCandidates,
  findPublishedProductSitemapEntries,
  runInTransaction,
  searchProductsByName,
  updateProductRecord,
  findVariantsBySkus,
} from "../product.repository"

beforeEach(() => vi.clearAllMocks())

describe("findManyProducts", () => {
  it("ordena por fecha descendente cuando no se indica otro orden", async () => {
    m.product.findMany.mockResolvedValue([])

    await findManyProducts()

    expect(m.product.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" })
  })

  it("respeta el orden, el filtro y la paginación recibidos", async () => {
    m.product.findMany.mockResolvedValue([])

    await findManyProducts({ isPublished: true }, { basePrice: "asc" }, 10, 20)

    expect(m.product.findMany.mock.calls[0][0]).toMatchObject({
      where: { isPublished: true },
      orderBy: { basePrice: "asc" },
      take: 10,
      skip: 20,
    })
  })
})

describe("findProductCatalogCandidates", () => {
  it("solo trae id y familia de color, que es lo que necesita el colapso de variantes", async () => {
    m.product.findMany.mockResolvedValue([])

    await findProductCatalogCandidates({ isPublished: true }, { createdAt: "desc" })

    expect(m.product.findMany).toHaveBeenCalledWith({
      where: { isPublished: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, colorFamilyId: true },
    })
  })
})

describe("findProductById y findProductByIdForAdmin", () => {
  it("la consulta pública busca por id", async () => {
    m.product.findUnique.mockResolvedValue(null)

    await findProductById("prod_1")

    expect(m.product.findUnique.mock.calls[0][0].where).toEqual({ id: "prod_1" })
  })

  it("la consulta del admin trae variantes ordenadas por SKU y su inventario por tienda", async () => {
    m.product.findUnique.mockResolvedValue(null)

    await findProductByIdForAdmin("prod_1")

    const include = m.product.findUnique.mock.calls[0][0].include
    expect(include.variants.orderBy).toEqual({ sku: "asc" })
    expect(include.variants.include.inventory.include.storeLocation).toBe(true)
    expect(include.crossSells).toBeDefined()
  })
})

describe("countProducts", () => {
  it("cuenta con y sin filtro", async () => {
    m.product.count.mockResolvedValue(12)

    expect(await countProducts()).toBe(12)
    expect(await countProducts({ isPublished: true })).toBe(12)
  })
})

describe("escrituras simples", () => {
  it("crea y actualiza devolviendo las relaciones completas", async () => {
    m.product.create.mockResolvedValue({ id: "prod_1" })
    m.product.update.mockResolvedValue({ id: "prod_1" })

    await createProductRecord({ name: "Zapato" } as never)
    await updateProductRecord("prod_1", { name: "Zapato 2" })

    expect(m.product.create.mock.calls[0][0].include).toBeDefined()
    expect(m.product.update.mock.calls[0][0].where).toEqual({ id: "prod_1" })
  })

  it("borra variantes e imágenes por producto", async () => {
    m.variant.deleteMany.mockResolvedValue({ count: 2 })
    m.productImage.deleteMany.mockResolvedValue({ count: 3 })

    await deleteVariantsByProduct("prod_1")
    await deleteImagesByProduct("prod_1")

    expect(m.variant.deleteMany).toHaveBeenCalledWith({ where: { productId: "prod_1" } })
    expect(m.productImage.deleteMany).toHaveBeenCalledWith({ where: { productId: "prod_1" } })
  })
})

describe("searchProductsByName", () => {
  it("busca sin distinguir mayúsculas y devuelve 8 resultados por defecto", async () => {
    m.product.findMany.mockResolvedValue([])

    await searchProductsByName("air")

    const args = m.product.findMany.mock.calls[0][0]
    expect(args.where.AND[0]).toEqual({ name: { contains: "air", mode: "insensitive" } })
    expect(args.take).toBe(8)
  })

  it("excluye el producto actual cuando se indica, para no sugerirse a sí mismo", async () => {
    m.product.findMany.mockResolvedValue([])

    await searchProductsByName("air", "prod_1", 3)

    const args = m.product.findMany.mock.calls[0][0]
    expect(args.where.AND[1]).toEqual({ id: { not: "prod_1" } })
    expect(args.take).toBe(3)
  })
})

describe("deleteProductRecord", () => {
  it("elimina el producto sin tocar familias cuando no pertenece a ninguna", async () => {
    tx.product.findUnique.mockResolvedValue({ colorFamilyId: null })

    await deleteProductRecord("prod_1")

    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: "prod_1" } })
    expect(tx.productColorFamily.delete).not.toHaveBeenCalled()
  })

  it("disuelve la familia de color que se queda con un solo miembro", async () => {
    tx.product.findUnique.mockResolvedValue({ colorFamilyId: "fam_1" })
    tx.product.findMany.mockResolvedValue([{ id: "prod_2" }])

    await deleteProductRecord("prod_1")

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { colorFamilyId: "fam_1" },
      data: { colorFamilyId: null },
    })
    expect(tx.productColorFamily.delete).toHaveBeenCalledWith({ where: { id: "fam_1" } })
  })

  it("conserva la familia que aún tiene dos o más miembros", async () => {
    tx.product.findUnique.mockResolvedValue({ colorFamilyId: "fam_1" })
    tx.product.findMany.mockResolvedValue([{ id: "prod_2" }, { id: "prod_3" }])

    await deleteProductRecord("prod_1")

    expect(tx.productColorFamily.delete).not.toHaveBeenCalled()
  })

  it("toma el bloqueo consultivo para no competir con la reconciliación de familias", async () => {
    tx.product.findUnique.mockResolvedValue({ colorFamilyId: null })

    await deleteProductRecord("prod_1")

    expect(tx.$executeRaw).toHaveBeenCalled()
  })
})

describe("findPublishedProductSitemapEntries", () => {
  it("solo devuelve productos publicados, con su fecha de actualización", async () => {
    m.product.findMany.mockResolvedValue([
      { slug: "air-force-1", updatedAt: new Date("2026-08-01T00:00:00Z") },
    ])

    const entries = await findPublishedProductSitemapEntries()

    expect(m.product.findMany).toHaveBeenCalledWith({
      where: { isPublished: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    })
    expect(entries[0].slug).toBe("air-force-1")
  })
})

describe("runInTransaction", () => {
  it("ejecuta la función recibida dentro de una transacción", async () => {
    const resultado = await runInTransaction(async () => "listo")

    expect(resultado).toBe("listo")
  })
})

describe("findVariantsBySkus", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no consulta la base si no hay SKUs", async () => {
    expect(await findVariantsBySkus([])).toEqual([])
    expect(m.variant.findMany).not.toHaveBeenCalled()
  })

  it("trae el erpId del producto para poder respetar los productos del ERP", async () => {
    m.variant.findMany.mockResolvedValue([])
    await findVariantsBySkus(["A-1"])
    expect(m.variant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sku: { in: ["A-1"] } },
        select: expect.objectContaining({
          product: { select: { id: true, slug: true, name: true, erpId: true } },
        }),
      })
    )
  })
})
