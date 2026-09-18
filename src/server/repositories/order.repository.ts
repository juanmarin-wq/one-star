import "server-only"
import { prisma } from "../db/prisma"
import type { Prisma, OrderStatus, PaymentStatus } from "@prisma/client"

export async function createOrder(data: Prisma.OrderCreateInput) {
  return prisma.order.create({
    data,
    include: { items: true },
  })
}

export async function findOrderById(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: true, variant: true } },
      user: true,
    },
  })
}

export async function findManyOrders(
  take?: number,
  skip?: number,
  where?: Prisma.OrderWhereInput
) {
  return prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
    include: {
      items: { include: { product: true, variant: true } },
      user: true,
    },
  })
}

export async function findOrdersByUserId(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              images: { select: { url: true, alt: true }, take: 1 },
            },
          },
        },
      },
    },
  })
}

export async function countOrders(where?: Prisma.OrderWhereInput): Promise<number> {
  return prisma.order.count({ where })
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  return prisma.order.update({ where: { id }, data: { status } })
}

export async function updateOrderStatusAndTracking(
  id: string,
  status: string,
  trackingNumber?: string
) {
  return prisma.order.update({
    where: { id },
    data: {
      status: status as OrderStatus,
      ...(trackingNumber !== undefined ? { trackingNumber } : {}),
    },
  })
}

/**
 * Registra el desenlace de un pago que NO fue aprobado (rechazo, fallo,
 * vencimiento o cancelación manual de un pedido sin pagar). Solo afecta
 * pedidos cuyo pago sigue sin confirmar: un pedido ya APPROVED nunca se
 * degrada por esta vía. Devuelve `true` si la fila cambió.
 */
export async function closeUnpaidOrder(
  id: string,
  paymentStatus: Exclude<PaymentStatus, "APPROVED">
): Promise<boolean> {
  const result = await prisma.order.updateMany({
    where: { id, paymentStatus: { not: "APPROVED" }, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED", paymentStatus },
  })
  return result.count > 0
}

/**
 * Pedidos PENDING creados antes de `before` que nunca recibieron ninguna
 * notificación de la pasarela (sin `paymentReference`): el cliente abrió el
 * checkout de ePayco pero no completó el pago.
 */
export async function findAbandonedPendingOrders(before: Date) {
  return prisma.order.findMany({
    where: {
      status: "PENDING",
      paymentStatus: "PENDING",
      paymentReference: null,
      createdAt: { lt: before },
    },
    select: { id: true, shippingAddress: true },
  })
}

export interface OrderCustomerDataUpdate {
  customerName: string
  customerEmail: string
  shippingAddress: Prisma.InputJsonValue
}

export async function updateOrderCustomerData(id: string, data: OrderCustomerDataUpdate) {
  return prisma.order.update({ where: { id }, data })
}

/**
 * Devuelve el stock actual de las variantes solicitadas.
 * Usado para validar disponibilidad antes de crear un pedido.
 */
export async function getVariantsStock(variantIds: string[]) {
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, stock: true, sku: true },
  })
  return variants.map(v => ({
    id: v.id,
    stock: v.stock,
    sku: v.sku
  }))
}

/**
 * Refleja la venta en el desglose por sede: descuenta de las tiendas con más
 * existencias hasta cubrir la cantidad. `Variant.stock` sigue siendo la fuente
 * transaccional; el ERP vuelve a alinear el desglose en la próxima sincronización.
 */
async function decrementStoreInventory(
  tx: Prisma.TransactionClient,
  variantId: string,
  quantity: number
): Promise<void> {
  const levels = await tx.inventoryLevel.findMany({
    where: { variantId, storeLocationId: { not: null }, stock: { gt: 0 } },
    orderBy: { stock: "desc" },
    select: { id: true, stock: true },
  })
  let remaining = quantity
  for (const level of levels) {
    if (remaining <= 0) break
    const taken = Math.min(level.stock, remaining)
    await tx.inventoryLevel.update({
      where: { id: level.id },
      data: { stock: { decrement: taken } },
    })
    remaining -= taken
  }
}

/**
 * Marca un pedido como PAID (pago APPROVED con `paidAt`) y descuenta el stock
 * de cada variante dentro de una transacción. Re-valida el stock para evitar
 * sobreventa por condiciones de carrera. Idempotente: si el pedido ya está
 * PAID no descuenta de nuevo.
 */
export async function markOrderPaidWithStock(id: string, trackingNumber?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!order) throw new Error("Pedido no encontrado.")

    // Idempotencia: no descontar dos veces si ya estaba pagado.
    if (order.status === "PAID") {
      if (trackingNumber !== undefined) {
        return tx.order.update({ where: { id }, data: { trackingNumber } })
      }
      return order
    }

    // Reclama la transición → PAID de forma atómica ANTES de tocar el stock.
    // La lectura de arriba no basta: la transacción corre en READ COMMITTED, así
    // que dos reintentos concurrentes del webhook de ePayco pueden leer ambos el
    // estado previo. El UPDATE condicional bloquea la fila y reevalúa el WHERE,
    // de modo que solo una transacción afecta una fila y descuenta existencias.
    const claimed = await tx.order.updateMany({
      where: { id, status: { not: "PAID" } },
      data: {
        status: "PAID",
        paymentStatus: "APPROVED",
        paidAt: new Date(),
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
      },
    })
    if (claimed.count === 0) {
      // Otra entrega ganó la carrera y ya descontó el stock.
      return tx.order.findUniqueOrThrow({ where: { id } })
    }

    for (const item of order.items) {
      if (!item.variantId) continue
      // Decremento condicional: el propio UPDATE revalida las existencias sobre
      // la fila bloqueada, así dos ventas simultáneas no dejan el stock negativo.
      const decremented = await tx.variant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      })
      if (decremented.count === 0) {
        // Revierte la reclamación de PAID junto con el resto de la transacción.
        throw new Error(
          `Stock insuficiente para completar el pedido (variante ${item.variantId}).`
        )
      }
      await decrementStoreInventory(tx, item.variantId, item.quantity)
    }

    return tx.order.findUniqueOrThrow({ where: { id } })
  })
}

/**
 * Métricas del dashboard. Solo cuentan como pedidos los que tienen el pago
 * confirmado; los "pendientes" son ventas pagadas que aún no se despachan.
 */
export async function getOrderStats() {
  const [total, pending] = await Promise.all([
    prisma.order.count({ where: { paymentStatus: "APPROVED" } }),
    prisma.order.count({ where: { status: "PAID" } }),
  ])

  const revenueResult = await prisma.order.aggregate({
    _sum: { total: true },
    where: { paymentStatus: "APPROVED", status: { not: "CANCELLED" } },
  })

  return {
    totalCount: total,
    pendingCount: pending,
    revenue: revenueResult._sum.total?.toNumber() ?? 0,
  }
}

export async function updateOrderPaymentReference(id: string, paymentReference: string) {
  return prisma.order.update({ where: { id }, data: { paymentReference } })
}
