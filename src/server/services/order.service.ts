import "server-only"
import {
  createOrder,
  findOrderById,
  findManyOrders,
  findOrdersByUserId,
  countOrders,
  updateOrderStatus,
  updateOrderStatusAndTracking,
  getOrderStats,
  getVariantsStock,
  markOrderPaidWithStock,
  closeUnpaidOrder,
  findAbandonedPendingOrders,
  updateOrderCustomerData as updateOrderCustomerDataRecord,
} from "../repositories/order.repository"
import { findVariantsForPricing } from "../repositories/variant.repository"
import type { Prisma, OrderStatus, PaymentStatus } from "@prisma/client"
import { getERPAdapter } from "../erp"
import { sendOrderConfirmationEmail } from "./email.service"
import { getShippingCost, type ShippingMethod } from "@/lib/shipping"
import { isGiftCardSku } from "@/lib/gift-card"
import {
  validateCouponForOrder,
  registerCouponUsage,
  releaseCouponUsage,
  releaseCouponUsageByCode,
} from "./coupon.service"
import type { OrderCustomerDataInput } from "../validators/order.validator"

/**
 * Horas que un pedido puede permanecer PENDING sin ninguna notificación de la
 * pasarela antes de considerarse abandonado (el cliente llegó al checkout de
 * ePayco pero nunca pagó).
 */
export const ABANDONED_ORDER_TTL_HOURS = 24

export interface OrderItemDTO {
  id: string
  productId: string
  productName: string
  productImage: string | null
  quantity: number
  unitPrice: number
  /** SKU de la variante comprada; null en pedidos previos a la migración sin variante. */
  sku: string | null
}

export interface OrderDTO {
  id: string
  status: string
  paymentStatus: string
  paymentReference: string | null
  paidAt: string | null
  total: number
  paymentMethod: string | null
  trackingNumber: string | null
  customerEmail: string | null
  customerName: string | null
  shippingAddress: unknown
  userId: string | null
  userEmail: string | null
  createdAt: string
  updatedAt: string
  items?: OrderItemDTO[]
}

function mapToDTO(raw: {
  id: string
  status: string
  paymentStatus?: string | null
  paymentReference?: string | null
  paidAt?: Date | null
  total: { toNumber: () => number }
  paymentMethod: string | null
  trackingNumber: string | null
  customerEmail: string | null
  customerName: string | null
  shippingAddress: unknown
  userId: string | null
  user?: { email: string } | null
  createdAt: Date
  updatedAt: Date
  items?: Array<{
    id: string
    productId: string
    product?: { name?: string; images?: Array<{ url: string }> }
    variant?: { sku: string } | null
    quantity: number
    unitPrice: { toNumber: () => number }
  }>
}): OrderDTO {
  return {
    id: raw.id,
    status: raw.status,
    paymentStatus: raw.paymentStatus ?? "PENDING",
    paymentReference: raw.paymentReference ?? null,
    paidAt: raw.paidAt ? raw.paidAt.toISOString() : null,
    total: raw.total.toNumber(),
    paymentMethod: raw.paymentMethod,
    trackingNumber: raw.trackingNumber,
    customerEmail: raw.customerEmail,
    customerName: raw.customerName,
    shippingAddress: raw.shippingAddress,
    userId: raw.userId,
    userEmail: raw.user?.email ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
    items: raw.items
      ? raw.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product?.name ?? "Producto desconocido",
          productImage: item.product?.images?.[0]?.url ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toNumber(),
          sku: item.variant?.sku ?? null,
        }))
      : undefined,
  }
}

/**
 * Ítem del pedido tal como se persiste, con el precio resuelto en servidor.
 */
interface PricedOrderItem {
  productId: string
  variantId: string
  sku: string
  /** Id en el ERP; null cuando el producto solo existe en la web. */
  erpId: string | null
  productName: string
  quantity: number
  unitPrice: number
  categoryId: string
}

/**
 * Resuelve los precios reales desde la BD para cada ítem del carrito.
 * SEGURIDAD: los precios que envía el cliente se ignoran por completo;
 * unitPrice, sku y productName salen de la base de datos.
 */
async function priceItemsFromDatabase(
  items: { productId: string; variantId?: string; quantity: number; productName: string }[]
): Promise<PricedOrderItem[]> {
  const variantIds = items.map((i) => i.variantId).filter((id): id is string => Boolean(id))
  if (variantIds.length !== items.length) {
    throw new Error("Todos los ítems del pedido deben incluir una variante.")
  }

  const variants = await findVariantsForPricing(variantIds)
  const variantMap = new Map(variants.map((v) => [v.id, v]))

  return items.map((item) => {
    const variant = item.variantId ? variantMap.get(item.variantId) : undefined
    if (!variant) {
      throw new Error(`La variante del producto "${item.productName}" ya no está disponible.`)
    }
    if (variant.productId !== item.productId) {
      throw new Error(`Datos de pedido inconsistentes para "${item.productName}".`)
    }
    const { product } = variant
    const unitPrice =
      product.isOnSale && product.salePrice !== null
        ? product.salePrice.toNumber()
        : product.basePrice.toNumber()
    return {
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku,
      erpId: variant.erpId ?? null,
      productName: product.name,
      quantity: item.quantity,
      unitPrice,
      categoryId: product.categoryId,
    }
  })
}

export async function placeOrder(
  userId: string | null,
  data: {
    /**
     * items incluye sku y productName solo como referencia del cliente;
     * el servidor resuelve precio, sku y nombre reales desde la BD.
     */
    items: {
      productId: string
      variantId?: string
      sku: string
      productName: string
      quantity: number
    }[]
    shippingMethod: ShippingMethod
    shippingAddress?: unknown
    customerName?: string
    customerEmail?: string
    paymentMethod?: string
    /** Código de cupón; el descuento se valida y recalcula en servidor */
    couponCode?: string
  }
): Promise<OrderDTO> {
  // 0. SEGURIDAD: recalcula precios desde la BD. El total nunca viene del cliente.
  const pricedItems = await priceItemsFromDatabase(data.items)
  const subtotal = pricedItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  // El envío gratis se decide sobre el subtotal antes del descuento. Un pedido
  // solo de tarjetas de regalo es digital: se entrega por correo, sin envío.
  const digitalOnly = pricedItems.every((i) => isGiftCardSku(i.sku))
  const shippingCost = getShippingCost(data.shippingMethod, subtotal, { digitalOnly })

  // 0.2 Cupón: se revalida en servidor y el descuento se recalcula desde la BD.
  let appliedCoupon: { id: string; code: string; discountAmount: number } | null = null
  if (data.couponCode) {
    const validation = await validateCouponForOrder(
      data.couponCode,
      pricedItems.map((i) => ({ categoryId: i.categoryId, unitPrice: i.unitPrice, quantity: i.quantity }))
    )
    if (!validation.valid) {
      throw new Error(`El cupón "${data.couponCode}" ya no es válido: ${validation.reason}`)
    }
    appliedCoupon = {
      id: validation.id,
      code: validation.code,
      discountAmount: validation.discountAmount,
    }
  }

  const discountAmount = appliedCoupon?.discountAmount ?? 0
  const total = subtotal - discountAmount + shippingCost

  // 0.1 Valida disponibilidad de stock ANTES de crear el pedido.
  //     El stock se descuenta luego al marcar el pedido como PAID, pero se
  //     rechaza de entrada si ya no hay unidades suficientes.
  const variantIds = pricedItems.map((i) => i.variantId)

  if (variantIds.length > 0) {
    const stocks = await getVariantsStock(variantIds)
    const stockMap = new Map(stocks.map((s) => [s.id, s.stock]))
    for (const item of pricedItems) {
      const available = stockMap.get(item.variantId) ?? 0
      if (available < item.quantity) {
        throw new Error(`Stock local insuficiente para "${item.productName}".`)
      }
    }
  }

  // 0.5 Validación de Stock en Tiempo Real (JIT) contra el ERP. Solo aplica a
  //     variantes vinculadas al ERP (erpId): las tarjetas de regalo y los
  //     productos cargados a mano no existen allá y Loggro los reportaría como
  //     agotados, bloqueando la compra.
  const erp = getERPAdapter()
  const erpItemsToValidate = pricedItems
    .filter((i) => i.erpId !== null)
    .map((i) => ({ sku: i.sku, qty: i.quantity }))
  if (erp.validateStock && erpItemsToValidate.length > 0) {
    const isValidInERP = await erp.validateStock(erpItemsToValidate)

    if (!isValidInERP) {
      throw new Error(`Lo sentimos, el stock de uno o más productos se agotó en la tienda principal justo ahora. Por favor actualiza tu carrito.`)
    }
  }

  // El shippingAddress registrado refleja el costo y descuento calculados en servidor
  const shippingAddress = {
    ...(typeof data.shippingAddress === "object" && data.shippingAddress !== null
      ? (data.shippingAddress as Record<string, unknown>)
      : {}),
    shippingMethod: data.shippingMethod,
    shippingCost,
    ...(appliedCoupon
      ? {
          couponId: appliedCoupon.id,
          couponCode: appliedCoupon.code,
          couponDiscount: appliedCoupon.discountAmount,
        }
      : {}),
  }

  const orderInput: Prisma.OrderCreateInput = {
    ...(userId ? { user: { connect: { id: userId } } } : {}),
    total,
    shippingAddress: shippingAddress as Prisma.InputJsonValue,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    paymentMethod: data.paymentMethod,
    items: {
      create: pricedItems.map((i) => ({
        product: { connect: { id: i.productId } },
        variant: { connect: { id: i.variantId } },
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    },
  }

  // 0.9 Reserva el uso del cupón ANTES de crear el pedido: el incremento es
  //     condicional (no supera maxUses), así dos compras concurrentes no
  //     exceden el tope. Si el pedido luego falla, se libera el uso.
  if (appliedCoupon) {
    const usageRegistered = await registerCouponUsage(appliedCoupon.id)
    if (!usageRegistered) {
      throw new Error(`El cupón "${appliedCoupon.code}" ya no es válido: alcanzó su límite de usos`)
    }
  }

  // 1. Persiste el pedido en la BD de One Star primero.
  //    El pedido siempre queda registrado, independientemente del ERP.
  let order: Awaited<ReturnType<typeof createOrder>>
  try {
    order = await createOrder(orderInput)
  } catch (error) {
    if (appliedCoupon) {
      await releaseCouponUsage(appliedCoupon.id)
    }
    throw error
  }

  // 2. Un pedido recién creado permanece PENDING (pago sin confirmar): todavía
  //    no genera movimientos en el ERP ni correo de confirmación. Ambos ocurren
  //    únicamente cuando la pasarela confirma el pago (ver payment.service).

  return mapToDTO(order)
}

/**
 * Envía al cliente el correo de confirmación de compra. Solo tiene sentido
 * para pedidos con pago aprobado; se llama desde la confirmación de pago y
 * desde el reenvío manual del admin.
 */
export async function sendOrderConfirmation(order: OrderDTO): Promise<void> {
  if (!order.customerEmail) return
  await sendOrderConfirmationEmail({
    email: order.customerEmail,
    name: order.customerName ?? undefined,
    orderId: order.id,
    items: (order.items ?? []).map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    total: order.total,
  })
}

export async function resendOrderConfirmation(id: string): Promise<void> {
  const order = await getOrderById(id)
  if (!order) throw new Error("Pedido no encontrado.")
  if (order.paymentStatus !== "APPROVED") {
    throw new Error("Solo se puede reenviar la confirmación de un pedido con pago aprobado.")
  }
  if (!order.customerEmail) throw new Error("El pedido no tiene correo del cliente.")
  await sendOrderConfirmation(order)
}

export async function getOrderById(id: string): Promise<OrderDTO | null> {
  const order = await findOrderById(id)
  return order ? mapToDTO(order) : null
}

export async function getRecentOrders(take: number = 20): Promise<OrderDTO[]> {
  const orders = await findManyOrders(take)
  return orders.map(mapToDTO)
}

export async function getUserOrders(userId: string): Promise<OrderDTO[]> {
  const orders = await findOrdersByUserId(userId)
  return orders.map(mapToDTO)
}

/**
 * Filtros del listado administrativo. `ALL` son las ventas reales (pago
 * aprobado, en cualquier estado logístico); `UNPAID` agrupa todo lo que nunca
 * se pagó: pendientes de pago, rechazados, fallidos y vencidos.
 */
export const ADMIN_ORDER_FILTERS = [
  "ALL",
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "UNPAID",
] as const
export type AdminOrderFilter = (typeof ADMIN_ORDER_FILTERS)[number]

export function isAdminOrderFilter(value: string): value is AdminOrderFilter {
  return (ADMIN_ORDER_FILTERS as readonly string[]).includes(value)
}

export function buildAdminOrdersWhere(filter: AdminOrderFilter, q: string): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {}
  switch (filter) {
    case "ALL":
      where.paymentStatus = "APPROVED"
      break
    case "UNPAID":
      where.paymentStatus = { not: "APPROVED" }
      break
    case "CANCELLED":
      // Solo cancelaciones de ventas reales; un pago rechazado vive en UNPAID.
      where.status = "CANCELLED"
      where.paymentStatus = "APPROVED"
      break
    default:
      where.status = filter as OrderStatus
  }
  if (q) {
    where.OR = [
      { customerEmail: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ]
  }
  return where
}

export async function getAdminOrders(
  filter: AdminOrderFilter,
  q: string,
  page: number,
  pageSize: number
) {
  const where = buildAdminOrdersWhere(filter, q)

  const [rows, total] = await Promise.all([
    findManyOrders(pageSize, (page - 1) * pageSize, where),
    countOrders(where),
  ])

  return { orders: rows.map(mapToDTO), total }
}

export async function getOrderTabCounts(tabs: readonly AdminOrderFilter[]) {
  return Promise.all(tabs.map((tab) => countOrders(buildAdminOrdersWhere(tab, ""))))
}

/**
 * Libera el uso del cupón que se reservó al crear un pedido que no se pagó.
 * Prefiere el id (estable aunque el admin renombre el código); el código es
 * el respaldo para pedidos creados antes de guardar el id.
 */
async function releaseOrderCoupon(shippingAddress: unknown): Promise<void> {
  if (typeof shippingAddress !== "object" || shippingAddress === null) return
  const { couponId, couponCode } = shippingAddress as { couponId?: unknown; couponCode?: unknown }
  if (typeof couponId === "string" && couponId) {
    await releaseCouponUsage(couponId)
    return
  }
  if (typeof couponCode === "string" && couponCode) {
    await releaseCouponUsageByCode(couponCode)
  }
}

/**
 * Cierra un pedido cuyo pago no se concretó. El estado logístico pasa a
 * CANCELLED y `paymentStatus` registra el motivo (REJECTED / FAILED / EXPIRED).
 * Devuelve `false` si el pedido ya estaba cerrado o su pago está aprobado.
 */
export async function closeOrderWithoutPayment(
  id: string,
  reason: Exclude<PaymentStatus, "APPROVED" | "PENDING">
): Promise<boolean> {
  const order = await findOrderById(id)
  if (!order) throw new Error("Pedido no encontrado.")
  if (order.paymentStatus === "APPROVED") {
    throw new Error("El pedido tiene el pago aprobado; no se puede cerrar como no pagado.")
  }
  const closed = await closeUnpaidOrder(id, reason)
  if (closed) await releaseOrderCoupon(order.shippingAddress)
  return closed
}

/**
 * Cancelación manual desde el admin de un pedido que nunca se pagó. Conserva
 * el motivo que ya hubiera registrado la pasarela (rechazado / fallido); si no
 * hubo ninguno, queda como vencido sin pago.
 */
export async function cancelUnpaidOrder(id: string): Promise<void> {
  const order = await findOrderById(id)
  if (!order) throw new Error("Pedido no encontrado.")
  const reason =
    order.paymentStatus === "REJECTED" || order.paymentStatus === "FAILED"
      ? order.paymentStatus
      : "EXPIRED"
  await closeOrderWithoutPayment(id, reason)
}

/**
 * Vence los pedidos abandonados: PENDING, sin ninguna notificación de la
 * pasarela y más antiguos que `ABANDONED_ORDER_TTL_HOURS`. Devuelve los ids
 * que quedaron cerrados. Pensado para el cron diario.
 */
export async function expireAbandonedOrders(now: Date = new Date()): Promise<string[]> {
  const before = new Date(now.getTime() - ABANDONED_ORDER_TTL_HOURS * 60 * 60 * 1000)
  const stale = await findAbandonedPendingOrders(before)
  const expired: string[] = []
  for (const order of stale) {
    const closed = await closeUnpaidOrder(order.id, "EXPIRED")
    if (!closed) continue
    await releaseOrderCoupon(order.shippingAddress)
    expired.push(order.id)
  }
  return expired
}

export async function changeOrderStatus(
  id: string,
  status: OrderStatus
): Promise<void> {
  // Al pasar a PAID se descuenta el stock de forma transaccional.
  if (status === "PAID") {
    await markOrderPaidWithStock(id)
    return
  }
  await updateOrderStatus(id, status)
}

export async function changeOrderStatusAndTracking(
  id: string,
  status: string,
  trackingNumber?: string
): Promise<void> {
  if (status === "PAID") {
    await markOrderPaidWithStock(id, trackingNumber)
    return
  }
  if (status === "CANCELLED") {
    // Cancelar un pedido sin pago confirmado registra el motivo y libera el
    // cupón; cancelar una venta real solo cambia el estado logístico.
    const order = await findOrderById(id)
    if (!order) throw new Error("Pedido no encontrado.")
    if (order.paymentStatus !== "APPROVED") {
      await cancelUnpaidOrder(id)
      return
    }
  }
  await updateOrderStatusAndTracking(id, status, trackingNumber)
}

/**
 * Edita los datos de contacto y envío de un pedido desde el admin. Conserva
 * en `shippingAddress` los campos calculados en servidor (método y costo de
 * envío, cupón), que no se editan a mano.
 */
export async function updateOrderCustomerData(
  id: string,
  input: OrderCustomerDataInput
): Promise<void> {
  const order = await findOrderById(id)
  if (!order) throw new Error("Pedido no encontrado.")

  const current =
    typeof order.shippingAddress === "object" && order.shippingAddress !== null
      ? (order.shippingAddress as Record<string, unknown>)
      : {}

  const shippingAddress = {
    ...current,
    phone: input.phone,
    address: input.address,
    apartment: input.apartment ?? null,
    city: input.city,
    department: input.department,
    postalCode: input.postalCode ?? null,
  }

  await updateOrderCustomerDataRecord(id, {
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    shippingAddress: shippingAddress as Prisma.InputJsonValue,
  })
}

export async function getDashboardOrderStats() {
  return getOrderStats()
}
