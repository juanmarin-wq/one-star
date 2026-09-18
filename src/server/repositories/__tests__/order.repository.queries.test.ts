import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("server-only", () => ({}))

// El pago (markOrderPaidWithStock) se prueba aparte en order.repository.test.ts,
// que monta el mock de la transacción. Aquí van las consultas y actualizaciones
// directas, que no pasan por $transaction.
const m = vi.hoisted(() => ({
  order: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  variant: { findMany: vi.fn() },
}))

vi.mock("@/server/db/prisma", () => ({
  prisma: { order: m.order, variant: m.variant },
}))

import {
  countOrders,
  createOrder,
  findManyOrders,
  findOrderById,
  findOrdersByUserId,
  getOrderStats,
  getVariantsStock,
  updateOrderPaymentReference,
  updateOrderStatus,
  updateOrderStatusAndTracking,
} from "../order.repository"

beforeEach(() => vi.clearAllMocks())

describe("consultas de pedidos", () => {
  it("crea el pedido devolviendo sus ítems", async () => {
    m.order.create.mockResolvedValue({ id: "ord_1" })

    await createOrder({ total: 1000 } as never)

    expect(m.order.create).toHaveBeenCalledWith({
      data: { total: 1000 },
      include: { items: true },
    })
  })

  it("el detalle incluye los ítems con su producto y el usuario", async () => {
    m.order.findUnique.mockResolvedValue(null)

    await findOrderById("ord_1")

    expect(m.order.findUnique).toHaveBeenCalledWith({
      where: { id: "ord_1" },
      include: { items: { include: { product: true, variant: true } }, user: true },
    })
  })

  it("el listado pagina y ordena por fecha descendente", async () => {
    m.order.findMany.mockResolvedValue([])

    await findManyOrders(10, 20, { status: "PAID" })

    expect(m.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PAID" },
        orderBy: { createdAt: "desc" },
        take: 10,
        skip: 20,
      })
    )
  })

  it("los pedidos del cliente traen una sola imagen por producto", async () => {
    m.order.findMany.mockResolvedValue([])

    await findOrdersByUserId("user_1")

    const args = m.order.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ userId: "user_1" })
    expect(args.include.items.include.product.select.images.take).toBe(1)
  })

  it("cuenta sin filtro cuando no se pasa ninguno", async () => {
    m.order.count.mockResolvedValue(4)

    expect(await countOrders()).toBe(4)
    expect(m.order.count).toHaveBeenCalledWith({ where: undefined })
  })
})

describe("actualizaciones de estado", () => {
  it("cambia el estado del pedido", async () => {
    m.order.update.mockResolvedValue({ id: "ord_1" })

    await updateOrderStatus("ord_1", "SHIPPED")

    expect(m.order.update).toHaveBeenCalledWith({
      where: { id: "ord_1" },
      data: { status: "SHIPPED" },
    })
  })

  it("omite el número de guía cuando no se envía, en vez de borrarlo", async () => {
    m.order.update.mockResolvedValue({ id: "ord_1" })

    await updateOrderStatusAndTracking("ord_1", "SHIPPED")

    expect(m.order.update.mock.calls[0][0].data).toEqual({ status: "SHIPPED" })
  })

  it("guarda el número de guía cuando sí se envía", async () => {
    m.order.update.mockResolvedValue({ id: "ord_1" })

    await updateOrderStatusAndTracking("ord_1", "SHIPPED", "GUIA-123")

    expect(m.order.update.mock.calls[0][0].data).toEqual({
      status: "SHIPPED",
      trackingNumber: "GUIA-123",
    })
  })

  it("guarda la referencia de pago", async () => {
    m.order.update.mockResolvedValue({ id: "ord_1" })

    await updateOrderPaymentReference("ord_1", "ref-payco-9")

    expect(m.order.update).toHaveBeenCalledWith({
      where: { id: "ord_1" },
      data: { paymentReference: "ref-payco-9" },
    })
  })
})

describe("getVariantsStock", () => {
  it("devuelve id, stock y sku de las variantes pedidas", async () => {
    m.variant.findMany.mockResolvedValue([{ id: "var_1", stock: 3, sku: "SKU-1" }])

    expect(await getVariantsStock(["var_1"])).toEqual([
      { id: "var_1", stock: 3, sku: "SKU-1" },
    ])
  })
})

describe("getOrderStats", () => {
  it("suma solo las ventas con pago aprobado y cuenta las pendientes de despacho", async () => {
    m.order.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3)
    m.order.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal(1500) } })

    expect(await getOrderStats()).toEqual({
      totalCount: 10,
      pendingCount: 3,
      revenue: 1500,
    })
    expect(m.order.count).toHaveBeenNthCalledWith(1, { where: { paymentStatus: "APPROVED" } })
    expect(m.order.count).toHaveBeenNthCalledWith(2, { where: { status: "PAID" } })
    expect(m.order.aggregate).toHaveBeenCalledWith({
      _sum: { total: true },
      where: { paymentStatus: "APPROVED", status: { not: "CANCELLED" } },
    })
  })

  it("reporta cero ingresos cuando todavía no hay pedidos pagados", async () => {
    m.order.count.mockResolvedValue(0)
    m.order.aggregate.mockResolvedValue({ _sum: { total: null } })

    expect((await getOrderStats()).revenue).toBe(0)
  })
})
