import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const erpMocks = vi.hoisted(() => ({
  onOrderConfirmed: vi.fn().mockResolvedValue({ success: true }),
  // vi.fn(impl): la implementación sobrevive al mockReset del config de vitest.
  validateStock: vi.fn(async () => true),
}))

vi.mock("@/server/repositories/order.repository", () => ({
  createOrder: vi.fn(),
  findOrderById: vi.fn(),
  findManyOrders: vi.fn(),
  findOrdersByUserId: vi.fn(),
  countOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderStatusAndTracking: vi.fn(),
  getOrderStats: vi.fn(),
  getVariantsStock: vi.fn(),
  markOrderPaidWithStock: vi.fn(),
  closeUnpaidOrder: vi.fn(),
  findAbandonedPendingOrders: vi.fn(),
  updateOrderCustomerData: vi.fn(),
}))

vi.mock("@/server/erp", () => ({
  getERPAdapter: vi.fn(() => ({
    onOrderConfirmed: erpMocks.onOrderConfirmed,
    validateStock: erpMocks.validateStock,
  })),
}))

vi.mock("@/server/repositories/variant.repository", () => ({
  findVariantsForPricing: vi.fn(),
}))

vi.mock("@/server/services/coupon.service", () => ({
  validateCouponForOrder: vi.fn(),
  registerCouponUsage: vi.fn(),
  releaseCouponUsage: vi.fn(),
  releaseCouponUsageByCode: vi.fn(),
}))

vi.mock("@/server/services/email.service", () => ({
  sendOrderConfirmationEmail: vi.fn(),
}))

import {
  placeOrder,
  getOrderById,
  getRecentOrders,
  getUserOrders,
  getAdminOrders,
  changeOrderStatus,
  changeOrderStatusAndTracking,
  getOrderTabCounts,
  buildAdminOrdersWhere,
  cancelUnpaidOrder,
  closeOrderWithoutPayment,
  expireAbandonedOrders,
  updateOrderCustomerData as updateCustomer,
  resendOrderConfirmation,
  sendOrderConfirmation,
} from "../order.service"
import {
  createOrder,
  findOrderById,
  findManyOrders,
  findOrdersByUserId,
  countOrders,
  updateOrderStatus,
  updateOrderStatusAndTracking,
  getVariantsStock,
  markOrderPaidWithStock,
  closeUnpaidOrder,
  findAbandonedPendingOrders,
  updateOrderCustomerData,
} from "@/server/repositories/order.repository"
import { sendOrderConfirmationEmail } from "@/server/services/email.service"
import { findVariantsForPricing } from "@/server/repositories/variant.repository"
import {
  validateCouponForOrder,
  registerCouponUsage,
  releaseCouponUsage,
  releaseCouponUsageByCode,
} from "@/server/services/coupon.service"

const mockCreate = vi.mocked(createOrder)
const mockFindById = vi.mocked(findOrderById)
const mockFindMany = vi.mocked(findManyOrders)
const mockFindByUser = vi.mocked(findOrdersByUserId)
const mockCount = vi.mocked(countOrders)
const mockUpdateStatus = vi.mocked(updateOrderStatus)
const mockUpdateTracking = vi.mocked(updateOrderStatusAndTracking)
const mockGetStock = vi.mocked(getVariantsStock)
const mockMarkPaid = vi.mocked(markOrderPaidWithStock)
const mockPricing = vi.mocked(findVariantsForPricing)
const mockValidateCoupon = vi.mocked(validateCouponForOrder)
const mockRegisterUsage = vi.mocked(registerCouponUsage)
const mockReleaseUsage = vi.mocked(releaseCouponUsage)
const mockReleaseByCode = vi.mocked(releaseCouponUsageByCode)
const mockCloseUnpaid = vi.mocked(closeUnpaidOrder)
const mockFindAbandoned = vi.mocked(findAbandonedPendingOrders)
const mockUpdateCustomer = vi.mocked(updateOrderCustomerData)
const mockSendEmail = vi.mocked(sendOrderConfirmationEmail)

const makeDecimal = (n: number) => ({ toNumber: () => n })

/** Variante como la devuelve findVariantsForPricing (precio real en BD: 135.000) */
const pricedVariant = {
  id: "var-1",
  sku: "NK-001",
  erpId: "erp-var-1",
  stock: 5,
  productId: "prod-1",
  product: {
    id: "prod-1",
    name: "Nike Air Max",
    basePrice: makeDecimal(135000),
    isOnSale: false,
    salePrice: null,
    categoryId: "cat-1",
  },
}

const rawOrder = {
  id: "order-1",
  status: "PENDING",
  paymentStatus: "PENDING",
  paymentReference: null,
  paidAt: null,
  total: makeDecimal(270000),
  paymentMethod: "card",
  trackingNumber: null,
  customerEmail: "test@example.com",
  customerName: "Juan Pérez",
  shippingAddress: { city: "Bogotá" },
  userId: "user-1",
  user: { email: "test@example.com" },
  createdAt: new Date("2024-03-01"),
  updatedAt: new Date("2024-03-01"),
  items: [
    {
      id: "item-1",
      productId: "prod-1",
      orderId: "order-1",
      variantId: null,
      product: { name: "Nike Air Max", images: [{ url: "/nike.jpg" }] },
      quantity: 2,
      unitPrice: makeDecimal(120000),
    },
  ],
}

const orderInput = {
  items: [
    {
      productId: "prod-1",
      variantId: "var-1",
      sku: "NK-001",
      productName: "Nike Air Max",
      quantity: 2,
    },
  ],
  shippingMethod: "standard" as const,
  customerName: "Juan Pérez",
  customerEmail: "test@example.com",
  paymentMethod: "card",
}

describe("placeOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricing.mockResolvedValue([pricedVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])
  })

  it("persiste el pedido y retorna el DTO", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)
    const result = await placeOrder("user-1", orderInput)
    expect(result.id).toBe("order-1")
    expect(result.total).toBe(270000)
    expect(result.status).toBe("PENDING")
  })

  it("mapea los items del pedido correctamente", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)
    const result = await placeOrder("user-1", orderInput)
    expect(result.items).toHaveLength(1)
    expect(result.items![0].productName).toBe("Nike Air Max")
    expect(result.items![0].unitPrice).toBe(120000)
  })

  it("funciona para usuario invitado (userId null)", async () => {
    mockCreate.mockResolvedValue({ ...rawOrder, userId: null, user: null } as never)
    const result = await placeOrder(null, orderInput)
    expect(result.userId).toBeNull()
    expect(result.userEmail).toBeNull()
  })

  it("siempre llama a createOrder independientemente del ERP", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)
    await placeOrder("user-1", orderInput)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("no notifica al ERP mientras el pedido permanece pendiente", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)

    await placeOrder("user-1", orderInput)

    expect(erpMocks.onOrderConfirmed).not.toHaveBeenCalled()
  })
})

describe("placeOrder — productos que no existen en el ERP (tarjetas de regalo)", () => {
  const giftCardVariant = {
    ...pricedVariant,
    id: "var-gift",
    sku: "GIFT-CARD-50000",
    erpId: null,
    stock: 9999,
    productId: "prod-gift",
    product: {
      ...pricedVariant.product,
      id: "prod-gift",
      name: "Tarjeta de Regalo $50.000",
      basePrice: makeDecimal(50000),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate.mockResolvedValue(rawOrder as never)
  })

  it("no valida contra el ERP y no cobra envío cuando el pedido es solo digital", async () => {
    mockPricing.mockResolvedValue([giftCardVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-gift", stock: 9999, sku: "GIFT-CARD-50000" }])

    await placeOrder("user-1", {
      items: [{ productId: "prod-gift", variantId: "var-gift", sku: "GIFT-CARD-50000", productName: "Tarjeta", quantity: 1 }],
      shippingMethod: "standard",
    })

    expect(erpMocks.validateStock).not.toHaveBeenCalled()
    const input = mockCreate.mock.calls[0][0]
    expect(input.total).toBe(50000)
    expect((input.shippingAddress as { shippingCost: number }).shippingCost).toBe(0)
  })

  it("en un carrito mixto solo envía al ERP los SKU vinculados y sí cobra envío", async () => {
    mockPricing.mockResolvedValue([pricedVariant, giftCardVariant] as never)
    mockGetStock.mockResolvedValue([
      { id: "var-1", stock: 5, sku: "NK-001" },
      { id: "var-gift", stock: 9999, sku: "GIFT-CARD-50000" },
    ])

    await placeOrder("user-1", {
      items: [
        { productId: "prod-1", variantId: "var-1", sku: "NK-001", productName: "Nike", quantity: 1 },
        { productId: "prod-gift", variantId: "var-gift", sku: "GIFT-CARD-50000", productName: "Tarjeta", quantity: 1 },
      ],
      shippingMethod: "standard",
    })

    expect(erpMocks.validateStock).toHaveBeenCalledWith([{ sku: "NK-001", qty: 1 }])
    const input = mockCreate.mock.calls[0][0]
    // 185.000 < 200.000: hay un producto físico, así que el estándar se cobra
    expect((input.shippingAddress as { shippingCost: number }).shippingCost).toBe(15000)
    expect(input.total).toBe(200000)
  })

  it("bloquea la compra si el ERP reporta agotado un producto vinculado", async () => {
    // Once: la implementación por defecto (true) debe seguir vigente para los demás tests.
    erpMocks.validateStock.mockResolvedValueOnce(false)
    mockPricing.mockResolvedValue([pricedVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])

    await expect(
      placeOrder("user-1", {
        items: [{ productId: "prod-1", variantId: "var-1", sku: "NK-001", productName: "Nike", quantity: 1 }],
        shippingMethod: "standard",
      })
    ).rejects.toThrow("tienda principal")
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("placeOrder — cupones", () => {
  const validCoupon = {
    valid: true as const,
    id: "cup-1",
    code: "PROMO20",
    discountType: "FIXED_AMOUNT" as const,
    discountValue: 20000,
    discountAmount: 20000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPricing.mockResolvedValue([pricedVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])
    mockCreate.mockResolvedValue(rawOrder as never)
  })

  it("aplica el descuento del cupón al total (revalidado en servidor)", async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon)
    mockRegisterUsage.mockResolvedValue(true)
    // 2 × 135.000 = 270.000 → envío gratis; 270.000 − 20.000 = 250.000
    await placeOrder("user-1", { ...orderInput, couponCode: "PROMO20" })
    expect(mockValidateCoupon).toHaveBeenCalledWith("PROMO20", [
      { categoryId: "cat-1", unitPrice: 135000, quantity: 2 },
    ])
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ total: 250000 }))
  })

  it("registra el uso del cupón antes de crear el pedido", async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon)
    mockRegisterUsage.mockResolvedValue(true)
    await placeOrder("user-1", { ...orderInput, couponCode: "PROMO20" })
    expect(mockRegisterUsage).toHaveBeenCalledWith("cup-1")
    expect(mockRegisterUsage.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreate.mock.invocationCallOrder[0]
    )
  })

  it("rechaza el pedido cuando el cupón ya no es válido", async () => {
    mockValidateCoupon.mockResolvedValue({ valid: false, reason: "Cupón no válido" })
    await expect(
      placeOrder("user-1", { ...orderInput, couponCode: "GHOST" })
    ).rejects.toThrow(/cupón/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza el pedido si el tope de usos se agotó justo antes de crear", async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon)
    mockRegisterUsage.mockResolvedValue(false)
    await expect(
      placeOrder("user-1", { ...orderInput, couponCode: "PROMO20" })
    ).rejects.toThrow(/límite de usos/)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("libera el uso reservado si la creación del pedido falla", async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon)
    mockRegisterUsage.mockResolvedValue(true)
    mockCreate.mockRejectedValue(new Error("DB caída"))
    await expect(
      placeOrder("user-1", { ...orderInput, couponCode: "PROMO20" })
    ).rejects.toThrow("DB caída")
    expect(mockReleaseUsage).toHaveBeenCalledWith("cup-1")
  })

  it("registra código y descuento en el shippingAddress del pedido", async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon)
    mockRegisterUsage.mockResolvedValue(true)
    await placeOrder("user-1", { ...orderInput, couponCode: "PROMO20" })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingAddress: expect.objectContaining({
          couponCode: "PROMO20",
          couponDiscount: 20000,
        }),
      })
    )
  })

  it("no consulta cupones cuando el pedido no trae código", async () => {
    await placeOrder("user-1", orderInput)
    expect(mockValidateCoupon).not.toHaveBeenCalled()
    expect(mockRegisterUsage).not.toHaveBeenCalled()
  })
})

describe("placeOrder — seguridad de precios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricing.mockResolvedValue([pricedVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])
    mockCreate.mockResolvedValue(rawOrder as never)
  })

  it("calcula el total desde la BD, no desde el cliente", async () => {
    // 2 × 135.000 (precio BD) = 270.000 ≥ 200.000 → envío gratis
    await placeOrder("user-1", orderInput)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ total: 270000 })
    )
    const input = mockCreate.mock.calls[0][0] as {
      items: { create: { unitPrice: number }[] }
    }
    expect(input.items.create[0].unitPrice).toBe(135000)
  })

  it("usa el precio de oferta cuando el producto está en sale", async () => {
    mockPricing.mockResolvedValue([
      {
        ...pricedVariant,
        product: {
          ...pricedVariant.product,
          isOnSale: true,
          salePrice: makeDecimal(100000),
        },
      },
    ] as never)
    await placeOrder("user-1", orderInput)
    // 2 × 100.000 = 200.000 → envío gratis → total 200.000
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ total: 200000 })
    )
  })

  it("suma el costo de envío estándar bajo el umbral", async () => {
    await placeOrder("user-1", { ...orderInput, items: [{ ...orderInput.items[0], quantity: 1 }] })
    // 135.000 < 200.000 → envío 15.000 → total 150.000
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ total: 150000 })
    )
  })

  it("rechaza ítems sin variantId", async () => {
    await expect(
      placeOrder("user-1", {
        ...orderInput,
        items: [{ productId: "prod-1", sku: "NK-001", productName: "Nike Air Max", quantity: 1 }],
      })
    ).rejects.toThrow(/variante/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza cuando la variante no pertenece al producto indicado", async () => {
    await expect(
      placeOrder("user-1", {
        ...orderInput,
        items: [{ ...orderInput.items[0], productId: "otro-producto" }],
      })
    ).rejects.toThrow(/inconsistentes/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza cuando la variante ya no existe en la BD", async () => {
    mockPricing.mockResolvedValue([] as never)
    await expect(placeOrder("user-1", orderInput)).rejects.toThrow(/no está disponible/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("getOrderById", () => {
  beforeEach(() => vi.clearAllMocks())

  it("retorna el DTO cuando el pedido existe", async () => {
    mockFindById.mockResolvedValue(rawOrder as never)
    const result = await getOrderById("order-1")
    expect(result).not.toBeNull()
    expect(result!.customerName).toBe("Juan Pérez")
  })

  it("retorna null cuando el pedido no existe", async () => {
    mockFindById.mockResolvedValue(null)
    const result = await getOrderById("no-existe")
    expect(result).toBeNull()
  })
})

describe("getRecentOrders", () => {
  it("retorna la lista de pedidos recientes", async () => {
    mockFindMany.mockResolvedValue([rawOrder] as never)
    const result = await getRecentOrders(10)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("order-1")
  })
})

describe("getUserOrders", () => {
  it("retorna pedidos del usuario", async () => {
    mockFindByUser.mockResolvedValue([rawOrder] as never)
    const result = await getUserOrders("user-1")
    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe("user-1")
  })
})

describe("getAdminOrders", () => {
  beforeEach(() => vi.clearAllMocks())

  it("retorna pedidos paginados y total", async () => {
    mockFindMany.mockResolvedValue([rawOrder] as never)
    mockCount.mockResolvedValue(1)
    const result = await getAdminOrders("ALL", "", 1, 10)
    expect(result.total).toBe(1)
    expect(result.orders).toHaveLength(1)
  })

  it("filtra por status cuando no es ALL", async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)
    await getAdminOrders("SHIPPED", "", 1, 10)
    expect(mockFindMany).toHaveBeenCalledWith(
      10,
      0,
      expect.objectContaining({ status: "SHIPPED" })
    )
  })

  it("agrega búsqueda por email/nombre cuando hay query", async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)
    await getAdminOrders("ALL", "juan", 1, 10)
    expect(mockFindMany).toHaveBeenCalledWith(
      10,
      0,
      expect.objectContaining({ OR: expect.any(Array) })
    )
  })
})

describe("getOrderTabCounts", () => {
  it("retorna conteos para cada tab", async () => {
    mockCount.mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    const result = await getOrderTabCounts(["ALL", "UNPAID", "SHIPPED"])
    expect(result).toEqual([5, 3, 1])
  })
})

describe("changeOrderStatus", () => {
  it("llama al repositorio con id y status", async () => {
    mockUpdateStatus.mockResolvedValue(undefined as never)
    await changeOrderStatus("order-1", "SHIPPED")
    expect(mockUpdateStatus).toHaveBeenCalledWith("order-1", "SHIPPED")
  })
})

describe("changeOrderStatusAndTracking", () => {
  beforeEach(() => vi.clearAllMocks())

  it("llama al repositorio con id, status y tracking", async () => {
    mockUpdateTracking.mockResolvedValue(undefined as never)
    await changeOrderStatusAndTracking("order-1", "SHIPPED", "TRK123")
    expect(mockUpdateTracking).toHaveBeenCalledWith("order-1", "SHIPPED", "TRK123")
  })

  it("usa el flujo de descuento de stock al pasar a PAID", async () => {
    mockMarkPaid.mockResolvedValue(rawOrder as never)
    await changeOrderStatusAndTracking("order-1", "PAID", "TRK999")
    expect(mockMarkPaid).toHaveBeenCalledWith("order-1", "TRK999")
    expect(mockUpdateTracking).not.toHaveBeenCalled()
  })
})

describe("placeOrder — validación de stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricing.mockResolvedValue([pricedVariant] as never)
  })

  it("crea el pedido cuando hay stock suficiente", async () => {
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])
    mockCreate.mockResolvedValue(rawOrder as never)
    const result = await placeOrder("user-1", orderInput)
    expect(result.id).toBe("order-1")
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("rechaza el pedido cuando el stock es insuficiente", async () => {
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 1, sku: "NK-001" }])
    await expect(placeOrder("user-1", orderInput)).rejects.toThrow(
      /stock local insuficiente/i
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza cuando la variante no tiene stock registrado", async () => {
    mockGetStock.mockResolvedValue([])
    await expect(placeOrder("user-1", orderInput)).rejects.toThrow(
      /stock local insuficiente/i
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("changeOrderStatus — PAID descuenta stock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("usa markOrderPaidWithStock al pasar a PAID", async () => {
    mockMarkPaid.mockResolvedValue(rawOrder as never)
    await changeOrderStatus("order-1", "PAID")
    expect(mockMarkPaid).toHaveBeenCalledWith("order-1")
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it("usa updateOrderStatus normal para otros estados", async () => {
    mockUpdateStatus.mockResolvedValue(undefined as never)
    await changeOrderStatus("order-1", "DELIVERED")
    expect(mockUpdateStatus).toHaveBeenCalledWith("order-1", "DELIVERED")
    expect(mockMarkPaid).not.toHaveBeenCalled()
  })
})

describe("placeOrder — correo de confirmación", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricing.mockResolvedValue([pricedVariant] as never)
    mockGetStock.mockResolvedValue([{ id: "var-1", stock: 5, sku: "NK-001" }])
  })

  it("NO envía el correo al crear el pedido: el pago aún no está confirmado", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)

    await placeOrder("user-1", { ...orderInput, customerEmail: "test@example.com" })

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("expone el estado del pago en el DTO", async () => {
    mockCreate.mockResolvedValue(rawOrder as never)

    const result = await placeOrder("user-1", orderInput)

    expect(result.paymentStatus).toBe("PENDING")
    expect(result.paymentReference).toBeNull()
    expect(result.paidAt).toBeNull()
  })
})

describe("sendOrderConfirmation / resendOrderConfirmation", () => {
  beforeEach(() => vi.clearAllMocks())

  const paidRaw = {
    ...rawOrder,
    status: "PAID",
    paymentStatus: "APPROVED",
    paidAt: new Date("2024-03-02T10:00:00Z"),
  }

  it("envía el correo con los ítems y el total del pedido", async () => {
    mockFindById.mockResolvedValue(paidRaw as never)
    const order = await getOrderById("order-1")

    await sendOrderConfirmation(order!)

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
        orderId: "order-1",
        total: 270000,
        items: [{ productName: "Nike Air Max", quantity: 2, unitPrice: 120000 }],
      })
    )
  })

  it("no envía nada si el pedido no tiene correo", async () => {
    mockFindById.mockResolvedValue({ ...paidRaw, customerEmail: null } as never)
    const order = await getOrderById("order-1")

    await sendOrderConfirmation(order!)

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("reenvía la confirmación de un pedido con pago aprobado", async () => {
    mockFindById.mockResolvedValue(paidRaw as never)

    await resendOrderConfirmation("order-1")

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it("rechaza reenviar la confirmación de un pedido sin pago aprobado", async () => {
    mockFindById.mockResolvedValue(rawOrder as never)

    await expect(resendOrderConfirmation("order-1")).rejects.toThrow(/pago aprobado/)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe("buildAdminOrdersWhere", () => {
  it("ALL muestra únicamente ventas con pago aprobado", () => {
    expect(buildAdminOrdersWhere("ALL", "")).toEqual({ paymentStatus: "APPROVED" })
  })

  it("UNPAID agrupa todo lo que no tiene pago aprobado", () => {
    expect(buildAdminOrdersWhere("UNPAID", "")).toEqual({
      paymentStatus: { not: "APPROVED" },
    })
  })

  it("CANCELLED excluye los pagos rechazados (viven en UNPAID)", () => {
    expect(buildAdminOrdersWhere("CANCELLED", "")).toEqual({
      status: "CANCELLED",
      paymentStatus: "APPROVED",
    })
  })

  it("los estados logísticos filtran por status", () => {
    expect(buildAdminOrdersWhere("SHIPPED", "")).toEqual({ status: "SHIPPED" })
  })

  it("agrega la búsqueda por email o nombre", () => {
    const where = buildAdminOrdersWhere("ALL", "ana")
    expect(where.OR).toEqual([
      { customerEmail: { contains: "ana", mode: "insensitive" } },
      { customerName: { contains: "ana", mode: "insensitive" } },
    ])
  })
})

describe("closeOrderWithoutPayment", () => {
  beforeEach(() => vi.clearAllMocks())

  it("cierra el pedido con el motivo y libera el cupón reservado por id", async () => {
    mockFindById.mockResolvedValue({
      ...rawOrder,
      shippingAddress: { city: "Bogotá", couponId: "cup-1", couponCode: "PROMO20" },
    } as never)
    mockCloseUnpaid.mockResolvedValue(true)

    const closed = await closeOrderWithoutPayment("order-1", "REJECTED")

    expect(closed).toBe(true)
    expect(mockCloseUnpaid).toHaveBeenCalledWith("order-1", "REJECTED")
    expect(mockReleaseUsage).toHaveBeenCalledWith("cup-1")
    expect(mockReleaseByCode).not.toHaveBeenCalled()
  })

  it("libera por código los pedidos antiguos que no guardaron el id del cupón", async () => {
    mockFindById.mockResolvedValue({
      ...rawOrder,
      shippingAddress: { city: "Bogotá", couponCode: "PROMO20" },
    } as never)
    mockCloseUnpaid.mockResolvedValue(true)

    await closeOrderWithoutPayment("order-1", "REJECTED")

    expect(mockReleaseByCode).toHaveBeenCalledWith("PROMO20")
    expect(mockReleaseUsage).not.toHaveBeenCalled()
  })

  it("no libera cupón si el pedido no tenía", async () => {
    mockFindById.mockResolvedValue(rawOrder as never)
    mockCloseUnpaid.mockResolvedValue(true)

    await closeOrderWithoutPayment("order-1", "FAILED")

    expect(mockReleaseByCode).not.toHaveBeenCalled()
  })

  it("no libera cupón si el pedido ya estaba cerrado", async () => {
    mockFindById.mockResolvedValue({
      ...rawOrder,
      shippingAddress: { couponCode: "PROMO20" },
    } as never)
    mockCloseUnpaid.mockResolvedValue(false)

    const closed = await closeOrderWithoutPayment("order-1", "EXPIRED")

    expect(closed).toBe(false)
    expect(mockReleaseByCode).not.toHaveBeenCalled()
  })

  it("nunca degrada un pedido con pago aprobado", async () => {
    mockFindById.mockResolvedValue({ ...rawOrder, paymentStatus: "APPROVED" } as never)

    await expect(closeOrderWithoutPayment("order-1", "EXPIRED")).rejects.toThrow(/pago aprobado/)
    expect(mockCloseUnpaid).not.toHaveBeenCalled()
  })

  it("falla si el pedido no existe", async () => {
    mockFindById.mockResolvedValue(null)

    await expect(closeOrderWithoutPayment("nope", "EXPIRED")).rejects.toThrow(/no encontrado/)
  })
})

describe("cancelUnpaidOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCloseUnpaid.mockResolvedValue(true)
  })

  it("registra EXPIRED cuando la pasarela nunca respondió", async () => {
    mockFindById.mockResolvedValue(rawOrder as never)

    await cancelUnpaidOrder("order-1")

    expect(mockCloseUnpaid).toHaveBeenCalledWith("order-1", "EXPIRED")
  })

  it("conserva el motivo que ya registró la pasarela", async () => {
    mockFindById.mockResolvedValue({ ...rawOrder, paymentStatus: "REJECTED" } as never)

    await cancelUnpaidOrder("order-1")

    expect(mockCloseUnpaid).toHaveBeenCalledWith("order-1", "REJECTED")
  })
})

describe("changeOrderStatusAndTracking — CANCELLED", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCloseUnpaid.mockResolvedValue(true)
  })

  it("cancelar un pedido sin pago lo cierra como no pagado", async () => {
    mockFindById.mockResolvedValue(rawOrder as never)

    await changeOrderStatusAndTracking("order-1", "CANCELLED")

    expect(mockCloseUnpaid).toHaveBeenCalledWith("order-1", "EXPIRED")
    expect(mockUpdateTracking).not.toHaveBeenCalled()
  })

  it("cancelar una venta pagada solo cambia el estado logístico", async () => {
    mockFindById.mockResolvedValue({ ...rawOrder, status: "PAID", paymentStatus: "APPROVED" } as never)
    mockUpdateTracking.mockResolvedValue(undefined as never)

    await changeOrderStatusAndTracking("order-1", "CANCELLED", "TRK1")

    expect(mockCloseUnpaid).not.toHaveBeenCalled()
    expect(mockUpdateTracking).toHaveBeenCalledWith("order-1", "CANCELLED", "TRK1")
  })
})

describe("expireAbandonedOrders", () => {
  beforeEach(() => vi.clearAllMocks())

  it("busca pedidos anteriores al TTL de 24 horas", async () => {
    mockFindAbandoned.mockResolvedValue([])
    const now = new Date("2026-09-07T12:00:00Z")

    await expireAbandonedOrders(now)

    expect(mockFindAbandoned).toHaveBeenCalledWith(new Date("2026-09-06T12:00:00Z"))
  })

  it("vence cada pedido abandonado y libera sus cupones", async () => {
    mockFindAbandoned.mockResolvedValue([
      { id: "o-1", shippingAddress: { couponCode: "PROMO20" } },
      { id: "o-2", shippingAddress: null },
    ] as never)
    mockCloseUnpaid.mockResolvedValue(true)

    const expired = await expireAbandonedOrders()

    expect(expired).toEqual(["o-1", "o-2"])
    expect(mockCloseUnpaid).toHaveBeenCalledWith("o-1", "EXPIRED")
    expect(mockCloseUnpaid).toHaveBeenCalledWith("o-2", "EXPIRED")
    expect(mockReleaseByCode).toHaveBeenCalledTimes(1)
    expect(mockReleaseByCode).toHaveBeenCalledWith("PROMO20")
  })

  it("omite los que otra ejecución ya cerró", async () => {
    mockFindAbandoned.mockResolvedValue([{ id: "o-1", shippingAddress: { couponCode: "X" } }] as never)
    mockCloseUnpaid.mockResolvedValue(false)

    const expired = await expireAbandonedOrders()

    expect(expired).toEqual([])
    expect(mockReleaseByCode).not.toHaveBeenCalled()
  })
})

describe("updateOrderCustomerData", () => {
  beforeEach(() => vi.clearAllMocks())

  const input = {
    customerName: "Ana Gómez",
    customerEmail: "ana@example.com",
    phone: "3001234567",
    address: "Calle 1 # 2-3",
    apartment: undefined,
    city: "Medellín",
    department: "Antioquia",
    postalCode: "050001",
  }

  it("conserva método, costo de envío y cupón calculados en servidor", async () => {
    mockFindById.mockResolvedValue({
      ...rawOrder,
      shippingAddress: {
        phone: "1",
        address: "vieja",
        city: "Bogotá",
        shippingMethod: "express",
        shippingCost: 25000,
        couponCode: "PROMO20",
        couponDiscount: 20000,
      },
    } as never)
    mockUpdateCustomer.mockResolvedValue({} as never)

    await updateCustomer("order-1", input)

    expect(mockUpdateCustomer).toHaveBeenCalledWith("order-1", {
      customerName: "Ana Gómez",
      customerEmail: "ana@example.com",
      shippingAddress: {
        phone: "3001234567",
        address: "Calle 1 # 2-3",
        apartment: null,
        city: "Medellín",
        department: "Antioquia",
        postalCode: "050001",
        shippingMethod: "express",
        shippingCost: 25000,
        couponCode: "PROMO20",
        couponDiscount: 20000,
      },
    })
  })

  it("falla si el pedido no existe", async () => {
    mockFindById.mockResolvedValue(null)

    await expect(updateCustomer("nope", input)).rejects.toThrow(/no encontrado/)
    expect(mockUpdateCustomer).not.toHaveBeenCalled()
  })
})
