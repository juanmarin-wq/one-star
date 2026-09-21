import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.1.1.1" }) }))
vi.mock("@/server/services/coupon.service", () => ({ validateCouponForOrder: vi.fn() }))
vi.mock("@/server/repositories/variant.repository", () => ({ findVariantsForPricing: vi.fn() }))

import { validateCouponAction } from "../coupon.actions"
import { validateCouponForOrder } from "@/server/services/coupon.service"
import { findVariantsForPricing } from "@/server/repositories/variant.repository"

const dec = (n: number) => ({ toNumber: () => n })

function variant(id: string) {
  return {
    id,
    product: { categoryId: "cat-1", isOnSale: false, salePrice: null, basePrice: dec(100000) },
  }
}

beforeEach(() => vi.clearAllMocks())

describe("validateCouponAction", () => {
  it("rechaza en vez de ignorar un producto que ya no está disponible", async () => {
    vi.mocked(findVariantsForPricing).mockResolvedValue([variant("v1")] as never)
    const res = await validateCouponAction("PROMO", [
      { variantId: "v1", quantity: 1 },
      { variantId: "v-borrada", quantity: 1 },
    ])
    expect(res.valid).toBe(false)
    expect(validateCouponForOrder).not.toHaveBeenCalled()
  })

  it("resuelve precio y categoría en el servidor y valida el cupón", async () => {
    vi.mocked(findVariantsForPricing).mockResolvedValue([variant("v1")] as never)
    vi.mocked(validateCouponForOrder).mockResolvedValue({ valid: true, code: "PROMO", discountAmount: 10000 } as never)
    const res = await validateCouponAction("PROMO", [{ variantId: "v1", quantity: 2 }])
    expect(validateCouponForOrder).toHaveBeenCalledWith("PROMO", [
      { categoryId: "cat-1", unitPrice: 100000, quantity: 2 },
    ])
    expect(res).toEqual({ valid: true, code: "PROMO", discountAmount: 10000 })
  })
})
