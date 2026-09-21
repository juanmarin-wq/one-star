import { beforeEach, describe, expect, it, vi } from "vitest"
import * as XLSX from "xlsx"

vi.mock("server-only", () => ({}))

const txMock = {
  product: {
    create: vi.fn(async (args: { data: { name: string } }) => ({ id: "new-product-id", ...args.data })),
    findUnique: vi.fn(async () => null),
  },
  productImage: { findMany: vi.fn(async () => [] as { url: string }[]), createMany: vi.fn(async () => ({ count: 0 })) },
  variant: { create: vi.fn(async () => ({ id: "new-variant-id" })), update: vi.fn(async () => ({ id: "updated" })) },
  category: { upsert: vi.fn(async (args: { create: { name: string } }) => ({ id: "new-category-id", ...args.create })) },
  brand: { upsert: vi.fn(async (args: { create: { name: string } }) => ({ id: "new-brand-id", ...args.create })) },
}

vi.mock("@/server/db/prisma", () => ({
  prisma: { $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)) },
}))

vi.mock("@/server/repositories/category.repository", () => ({
  findManyCategories: vi.fn(async () => [{ id: "cat-calzado", name: "Calzado" }]),
}))

vi.mock("@/server/repositories/brand.repository", () => ({
  findManyBrands: vi.fn(async () => [{ id: "brand-nike", name: "Nike" }]),
}))

vi.mock("@/server/repositories/product.repository", () => ({
  findVariantsBySkus: vi.fn(async () => []),
}))

import { findVariantsBySkus } from "@/server/repositories/product.repository"
import { previewProductImport, applyProductImport } from "../product-import.service"

const COLUMNS = [
  "sku", "name", "brandName", "categoryName", "gender", "price", "isOnSale", "salePrice",
  "description", "extendedDescription", "size", "sizeUS", "sizeCM", "sizeEUR", "color", "stock",
  "image1", "image2", "image3", "videoUrl", "isPublished", "availableOnline", "availableInStores",
]

function baseRow(overrides: Record<string, string | number> = {}): (string | number)[] {
  const row: Record<string, string | number> = {
    sku: "NK-1", name: "Nike Pegasus 41", brandName: "Nike", categoryName: "Calzado",
    gender: "HOMBRE", price: 480000, isOnSale: "NO", salePrice: "",
    description: "desc", extendedDescription: "", size: "40", sizeUS: "8", sizeCM: "25.5", sizeEUR: "40",
    color: "Negro", stock: 5, image1: "https://ejemplo.com/a.jpg", image2: "", image3: "",
    videoUrl: "", isPublished: "SI", availableOnline: "SI", availableInStores: "SI",
    ...overrides,
  }
  return COLUMNS.map((c) => row[c])
}

function buildBuffer(rows: (string | number)[][]): ArrayBuffer {
  const aoa = [COLUMNS, COLUMNS.map(() => "nota"), ...rows]
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, "Productos")
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe("previewProductImport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findVariantsBySkus).mockResolvedValue([])
  })

  it("producto nuevo con una variante -> create_product", async () => {
    const preview = await previewProductImport(buildBuffer([baseRow()]))
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0].action).toBe("create_product")
    expect(preview.summary).toEqual({ newProducts: 1, newVariants: 0, updatedVariants: 0, errors: 0 })
  })

  it("varias filas del mismo producto se agrupan en variantes", async () => {
    const rows = [
      baseRow({ sku: "NK-1", size: "40" }),
      baseRow({ sku: "NK-2", size: "41" }),
    ]
    const preview = await previewProductImport(buildBuffer(rows))
    expect(preview.rows.map((r) => r.action)).toEqual(["create_product", "add_variant"])
    expect(preview.summary).toEqual({ newProducts: 1, newVariants: 1, updatedVariants: 0, errors: 0 })
  })

  it("SKU duplicado en el archivo marca error en la segunda fila", async () => {
    const rows = [baseRow({ sku: "NK-1" }), baseRow({ sku: "NK-1" })]
    const preview = await previewProductImport(buildBuffer(rows))
    expect(preview.rows[1].action).toBe("error")
    expect(preview.rows[1].message).toMatch(/duplicado/i)
  })

  it("SKU existente sin erpId -> update_variant", async () => {
    vi.mocked(findVariantsBySkus).mockResolvedValue([
      {
        id: "v1", sku: "NK-1", size: "39", color: "Negro", stock: 1,
        sizeUS: null, sizeCM: null, sizeEUR: null,
        product: { id: "p1", slug: "nike-pegasus-41", name: "Nike Pegasus 41", erpId: null },
      },
    ] as never)
    const preview = await previewProductImport(buildBuffer([baseRow({ sku: "NK-1" })]))
    expect(preview.rows[0].action).toBe("update_variant")
    expect(preview.summary.updatedVariants).toBe(1)
  })

  it("SKU gestionado por ERP se rechaza", async () => {
    vi.mocked(findVariantsBySkus).mockResolvedValue([
      {
        id: "v1", sku: "NK-1", size: "39", color: "Negro", stock: 1,
        sizeUS: null, sizeCM: null, sizeEUR: null,
        product: { id: "p1", slug: "erp-slug", name: "Nike Pegasus 41", erpId: "erp-123" },
      },
    ] as never)
    const preview = await previewProductImport(buildBuffer([baseRow({ sku: "NK-1" })]))
    expect(preview.rows[0].action).toBe("error")
    expect(preview.rows[0].message).toMatch(/gestionado por erp/i)
  })

  it("campos obligatorios vacíos generan error de fila", async () => {
    const preview = await previewProductImport(buildBuffer([baseRow({ sku: "" })]))
    expect(preview.rows[0].action).toBe("error")
  })
})

describe("applyProductImport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findVariantsBySkus).mockResolvedValue([])
  })

  it("crea el producto y su variante cuando el fingerprint coincide", async () => {
    const buffer = buildBuffer([baseRow()])
    const preview = await previewProductImport(buffer)
    const result = await applyProductImport(buffer, preview.fingerprint)
    expect(result).toEqual({ newProducts: 1, newVariants: 1, updatedVariants: 0 })
    expect(txMock.product.create).toHaveBeenCalledTimes(1)
    expect(txMock.variant.create).toHaveBeenCalledTimes(1)
  })

  it("falla sin escribir si el catálogo cambió desde la vista previa", async () => {
    const buffer = buildBuffer([baseRow()])
    await previewProductImport(buffer)
    await expect(applyProductImport(buffer, "fingerprint-viejo")).rejects.toThrow(/cambió/i)
    expect(txMock.product.create).not.toHaveBeenCalled()
  })

  it("nunca escribe sobre un producto gestionado por ERP", async () => {
    vi.mocked(findVariantsBySkus).mockResolvedValue([
      {
        id: "v1", sku: "NK-1", size: "39", color: "Negro", stock: 1,
        sizeUS: null, sizeCM: null, sizeEUR: null,
        product: { id: "p1", slug: "erp-slug", name: "Nike Pegasus 41", erpId: "erp-123" },
      },
    ] as never)
    const buffer = buildBuffer([baseRow({ sku: "NK-1" })])
    const preview = await previewProductImport(buffer)
    const result = await applyProductImport(buffer, preview.fingerprint)
    expect(result).toEqual({ newProducts: 0, newVariants: 0, updatedVariants: 0 })
    expect(txMock.product.create).not.toHaveBeenCalled()
    expect(txMock.variant.create).not.toHaveBeenCalled()
  })

  it("resuelve una categoría/marca nueva creándola", async () => {
    const buffer = buildBuffer([baseRow({ categoryName: "Ropa Nueva", brandName: "Marca Nueva" })])
    const preview = await previewProductImport(buffer)
    await applyProductImport(buffer, preview.fingerprint)
    expect(txMock.category.upsert).toHaveBeenCalledTimes(1)
    expect(txMock.brand.upsert).toHaveBeenCalledTimes(1)
    expect(txMock.product.create).toHaveBeenCalledTimes(1)
  })

  it("una fila que solo actualiza stock no crea categoría ni marca huérfanas", async () => {
    vi.mocked(findVariantsBySkus).mockResolvedValue([
      {
        id: "v1", sku: "NK-1", size: "39", color: "Negro", stock: 1,
        sizeUS: null, sizeCM: null, sizeEUR: null,
        product: { id: "p1", slug: "nike-pegasus-41", name: "Nike Pegasus 41", erpId: null },
      },
    ] as never)
    const buffer = buildBuffer([baseRow({ sku: "NK-1", categoryName: "Categoria Mal Escrita", brandName: "Marca Rara" })])
    const preview = await previewProductImport(buffer)
    await applyProductImport(buffer, preview.fingerprint)
    expect(txMock.variant.update).toHaveBeenCalledTimes(1)
    expect(txMock.category.upsert).not.toHaveBeenCalled()
    expect(txMock.brand.upsert).not.toHaveBeenCalled()
  })

  it("guarda las fotos de una variante nueva agregada a un producto existente", async () => {
    vi.mocked(findVariantsBySkus).mockResolvedValue([
      {
        id: "v1", sku: "NK-1", size: "39", color: "Negro", stock: 1,
        sizeUS: null, sizeCM: null, sizeEUR: null,
        product: { id: "p1", slug: "nike-pegasus-41", name: "Nike Pegasus 41", erpId: null },
      },
    ] as never)
    txMock.productImage.findMany.mockResolvedValueOnce([{ url: "https://ejemplo.com/vieja.jpg" }])
    const buffer = buildBuffer([
      baseRow({ sku: "NK-1" }),
      baseRow({ sku: "NK-2", color: "Azul", image1: "https://ejemplo.com/azul.jpg" }),
    ])
    const preview = await previewProductImport(buffer)
    await applyProductImport(buffer, preview.fingerprint)
    expect(txMock.variant.create).toHaveBeenCalledTimes(1)
    expect(txMock.productImage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ productId: "p1", url: "https://ejemplo.com/azul.jpg", color: "Azul", position: 1 }),
      ],
    })
  })
})
