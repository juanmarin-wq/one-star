import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("server-only", () => ({}))

vi.mock("@/server/repositories/gift-card.repository", () => ({
  findPurchasableGiftCardVariants: vi.fn(),
  createGiftCardRecord: vi.fn(),
  findGiftCardByCode: vi.fn(),
  redeemGiftCardAmountRecord: vi.fn(),
}))

vi.mock("../email.service", () => ({
  sendGiftCardEmail: vi.fn(async () => ({ success: true })),
}))

import {
  getGiftCardOptions,
  issueGiftCardsForOrder,
  issueAndSendGiftCardsForOrder,
  searchGiftCard,
  redeemGiftCard,
} from "@/server/services/gift-card.service"
import {
  findPurchasableGiftCardVariants,
  createGiftCardRecord,
  findGiftCardByCode,
  redeemGiftCardAmountRecord,
} from "@/server/repositories/gift-card.repository"
import { sendGiftCardEmail } from "../email.service"
import type { OrderDTO } from "../order.service"

const findVariants = vi.mocked(findPurchasableGiftCardVariants)

function variant(overrides: {
  id: string
  amount: number
  stock?: number
  sku?: string
  productId?: string
}) {
  return {
    id: overrides.id,
    sku: overrides.sku ?? `GIFT-CARD-${overrides.amount}`,
    stock: overrides.stock ?? 100,
    productId: overrides.productId ?? `prod-${overrides.id}`,
    product: { basePrice: new Prisma.Decimal(overrides.amount) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getGiftCardOptions", () => {
  it("devuelve los montos comprables ordenados de menor a mayor", async () => {
    findVariants.mockResolvedValue([
      variant({ id: "v3", amount: 200_000 }),
      variant({ id: "v1", amount: 50_000 }),
      variant({ id: "v2", amount: 100_000 }),
    ])

    const options = await getGiftCardOptions()

    expect(options.map((o) => o.amount)).toEqual([50_000, 100_000, 200_000])
    expect(options[0]).toMatchObject({
      variantId: "v1",
      productId: "prod-v1",
      sku: "GIFT-CARD-50000",
    })
  })

  it("descarta variantes sin stock para no ofrecer un monto que el checkout rechaza", async () => {
    findVariants.mockResolvedValue([
      variant({ id: "v1", amount: 50_000, stock: 0 }),
      variant({ id: "v2", amount: 100_000, stock: 5 }),
    ])

    const options = await getGiftCardOptions()

    expect(options.map((o) => o.variantId)).toEqual(["v2"])
  })

  it("descarta montos fuera del rango permitido", async () => {
    findVariants.mockResolvedValue([
      variant({ id: "v1", amount: 10_000 }),
      variant({ id: "v2", amount: 5_000_000 }),
      variant({ id: "v3", amount: 300_000 }),
    ])

    const options = await getGiftCardOptions()

    expect(options.map((o) => o.amount)).toEqual([300_000])
  })

  it("devuelve una lista vacía cuando no hay tarjetas publicadas", async () => {
    findVariants.mockResolvedValue([])

    expect(await getGiftCardOptions()).toEqual([])
  })
})

function decimal(value: number) {
  return { toNumber: () => value }
}

function baseOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: "order-1",
    status: "PAID",
    paymentStatus: "APPROVED",
    paymentReference: "ref-1",
    paidAt: "2026-09-17T00:00:00Z",
    total: 100000,
    paymentMethod: "epayco",
    trackingNumber: null,
    customerEmail: "cliente@example.com",
    customerName: "Cliente Uno",
    shippingAddress: null,
    userId: "user-1",
    userEmail: "cliente@example.com",
    createdAt: "2026-09-17T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
    items: [],
    ...overrides,
  }
}

describe("issueGiftCardsForOrder", () => {
  it("no emite nada si el pedido no tiene tarjetas de regalo", async () => {
    const order = baseOrder({
      items: [{ id: "i1", productId: "p1", productName: "Tenis", productImage: null, quantity: 1, unitPrice: 200000, sku: "NK-001" }],
    })
    const issued = await issueGiftCardsForOrder(order)
    expect(issued).toEqual([])
    expect(createGiftCardRecord).not.toHaveBeenCalled()
  })

  it("emite un código por unidad comprada", async () => {
    vi.mocked(createGiftCardRecord).mockImplementation(async (data) => ({
      id: "gc-1",
      code: data.code,
      balance: decimal(data.balance) as never,
      isActive: true,
      orderId: data.orderId,
      customerEmail: data.customerEmail,
      createdAt: new Date(),
    }))
    const order = baseOrder({
      items: [{ id: "i1", productId: "p1", productName: "Tarjeta de Regalo $100.000", productImage: null, quantity: 2, unitPrice: 100000, sku: "GIFT-CARD-100000" }],
    })
    const issued = await issueGiftCardsForOrder(order)
    expect(issued).toHaveLength(2)
    expect(issued.every((c) => c.balance === 100000)).toBe(true)
    expect(new Set(issued.map((c) => c.code)).size).toBe(2)
    expect(createGiftCardRecord).toHaveBeenCalledTimes(2)
  })

  it("pedido mixto solo emite la tarjeta de regalo", async () => {
    vi.mocked(createGiftCardRecord).mockImplementation(async (data) => ({
      id: "gc-1",
      code: data.code,
      balance: decimal(data.balance) as never,
      isActive: true,
      orderId: data.orderId,
      customerEmail: data.customerEmail,
      createdAt: new Date(),
    }))
    const order = baseOrder({
      items: [
        { id: "i1", productId: "p1", productName: "Tenis", productImage: null, quantity: 1, unitPrice: 200000, sku: "NK-001" },
        { id: "i2", productId: "p2", productName: "Tarjeta de Regalo $50.000", productImage: null, quantity: 1, unitPrice: 50000, sku: "GIFT-CARD-50000" },
      ],
    })
    const issued = await issueGiftCardsForOrder(order)
    expect(issued).toHaveLength(1)
    expect(issued[0].balance).toBe(50000)
  })
})

describe("issueAndSendGiftCardsForOrder", () => {
  it("envía el correo solo cuando se emitió al menos una tarjeta", async () => {
    vi.mocked(createGiftCardRecord).mockImplementation(async (data) => ({
      id: "gc-1",
      code: data.code,
      balance: decimal(data.balance) as never,
      isActive: true,
      orderId: data.orderId,
      customerEmail: data.customerEmail,
      createdAt: new Date(),
    }))
    const order = baseOrder({
      items: [{ id: "i1", productId: "p1", productName: "Tarjeta", productImage: null, quantity: 1, unitPrice: 100000, sku: "GIFT-CARD-100000" }],
    })
    await issueAndSendGiftCardsForOrder(order)
    expect(sendGiftCardEmail).toHaveBeenCalledTimes(1)
  })

  it("no envía correo si no hay tarjetas de regalo en el pedido", async () => {
    const order = baseOrder({ items: [] })
    await issueAndSendGiftCardsForOrder(order)
    expect(sendGiftCardEmail).not.toHaveBeenCalled()
  })
})

describe("searchGiftCard / redeemGiftCard", () => {
  it("código no encontrado devuelve null", async () => {
    vi.mocked(findGiftCardByCode).mockResolvedValue(null)
    const result = await searchGiftCard("OS-XXXX-XXXX-XXXX")
    expect(result).toBeNull()
  })

  it("código con saldo se puede canjear", async () => {
    vi.mocked(findGiftCardByCode).mockResolvedValue({
      id: "gc-1", code: "OS-AAAA-BBBB-CCCC", balance: decimal(50000) as never, isActive: true,
      orderId: "order-1", customerEmail: "c@x.com", createdAt: new Date(),
    })
    vi.mocked(redeemGiftCardAmountRecord).mockResolvedValue({
      id: "gc-1", code: "OS-AAAA-BBBB-CCCC", balance: decimal(20000) as never, isActive: true,
      orderId: "order-1", customerEmail: "c@x.com", createdAt: new Date(),
    })
    const result = await redeemGiftCard("os-aaaa-bbbb-cccc", 30000)
    expect(result.balance).toBe(20000)
    expect(redeemGiftCardAmountRecord).toHaveBeenCalledWith("OS-AAAA-BBBB-CCCC", 30000)
  })

  it("rechaza canjear más del saldo disponible", async () => {
    vi.mocked(findGiftCardByCode).mockResolvedValue({
      id: "gc-1", code: "OS-AAAA-BBBB-CCCC", balance: decimal(50000) as never, isActive: true,
      orderId: null, customerEmail: null, createdAt: new Date(),
    })
    await expect(redeemGiftCard("OS-AAAA-BBBB-CCCC", 80000)).rejects.toThrow(/excede el saldo/i)
    expect(redeemGiftCardAmountRecord).not.toHaveBeenCalled()
  })

  it("rechaza un código inexistente", async () => {
    vi.mocked(findGiftCardByCode).mockResolvedValue(null)
    await expect(redeemGiftCard("OS-NOPE-NOPE-NOPE", 1000)).rejects.toThrow(/no encontrado/i)
  })
})
