import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  giftCard: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
}))
const giftCard = vi.hoisted(() => ({ updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }))

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    giftCard,
  },
}))

import {
  issueMissingGiftCardsForOrder,
  redeemGiftCardAmountRecord,
} from "../gift-card.repository"

let n = 0
const gen = () => `CODE-${++n}`

beforeEach(() => {
  vi.clearAllMocks()
  n = 0
  tx.giftCard.findUnique.mockResolvedValue(null)
})

describe("issueMissingGiftCardsForOrder", () => {
  it("toma un lock por pedido y crea todas las tarjetas si no existía ninguna", async () => {
    tx.giftCard.count.mockResolvedValue(0)
    const issued = await issueMissingGiftCardsForOrder(
      { orderId: "o1", customerEmail: "a@b.co", balances: [100000, 50000] },
      gen
    )
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.giftCard.create).toHaveBeenCalledTimes(2)
    expect(issued.map((c) => c.balance)).toEqual([100000, 50000])
  })

  it("es idempotente: si el pedido ya tiene todas sus tarjetas no crea ninguna", async () => {
    tx.giftCard.count.mockResolvedValue(2)
    const issued = await issueMissingGiftCardsForOrder(
      { orderId: "o1", customerEmail: null, balances: [100000, 100000] },
      gen
    )
    expect(issued).toEqual([])
    expect(tx.giftCard.create).not.toHaveBeenCalled()
  })

  it("solo crea las que faltan tras una emisión parcial", async () => {
    tx.giftCard.count.mockResolvedValue(1)
    const issued = await issueMissingGiftCardsForOrder(
      { orderId: "o1", customerEmail: null, balances: [100000, 50000] },
      gen
    )
    expect(issued).toEqual([{ code: "CODE-1", balance: 50000 }])
  })

  it("regenera el código si ya existe", async () => {
    tx.giftCard.count.mockResolvedValue(0)
    tx.giftCard.findUnique.mockResolvedValueOnce({ id: "x" }).mockResolvedValue(null)
    const issued = await issueMissingGiftCardsForOrder(
      { orderId: "o1", customerEmail: null, balances: [100000] },
      gen
    )
    expect(issued[0].code).toBe("CODE-2")
  })
})

describe("redeemGiftCardAmountRecord", () => {
  it("exige saldo suficiente dentro del propio UPDATE atómico", async () => {
    giftCard.updateMany.mockResolvedValue({ count: 0 })
    const result = await redeemGiftCardAmountRecord("ABC", 5000)
    expect(giftCard.updateMany).toHaveBeenCalledWith({
      where: { code: "ABC", isActive: true, balance: { gte: 5000 } },
      data: { balance: { decrement: 5000 } },
    })
    expect(result).toBeNull()
  })
})
