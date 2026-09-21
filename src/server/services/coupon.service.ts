import "server-only"
import {
  findManyCoupons,
  findCouponByCode,
  createCouponRecord,
  updateCouponRecord,
  incrementCouponUsage,
  decrementCouponUsage,
} from "../repositories/coupon.repository"
import type { DiscountType } from "@prisma/client"

export interface CouponInput {
  code: string
  discountType: string
  discountValue: number
  minOrderAmount?: number | null
  maxUses?: number | null
  categoryId?: string | null
  validFrom: Date
  validUntil: Date
  isActive?: boolean
}

export interface CouponDTO {
  id: string
  code: string
  discountType: "PERCENTAGE" | "FIXED_AMOUNT"
  discountValue: number
  minOrderAmount: number | null
  maxUses: number | null
  usedCount: number
  validUntil: string
  isActive: boolean
}

export async function getAllCoupons(): Promise<CouponDTO[]> {
  const coupons = await findManyCoupons()
  return coupons.map((c) => ({
    id: c.id,
    code: c.code,
    discountType: c.discountType as "PERCENTAGE" | "FIXED_AMOUNT",
    discountValue: Number(c.discountValue),
    minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    validUntil: c.validUntil.toISOString(),
    isActive: c.isActive,
  }))
}

export async function validateCoupon(code: string) {
  const coupon = await findCouponByCode(code)
  if (
    !coupon ||
    !coupon.isActive ||
    coupon.validUntil < new Date() ||
    coupon.validFrom > new Date()
  ) {
    return null
  }
  return {
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue.toNumber(),
  }
}

export type CouponOrderValidation =
  | {
      valid: true
      id: string
      code: string
      discountType: "PERCENTAGE" | "FIXED_AMOUNT"
      discountValue: number
      /** Descuento en pesos ya calculado sobre el subtotal elegible */
      discountAmount: number
    }
  | { valid: false; reason: string }

/** Ítem del carrito ya resuelto desde la base de datos (precio y categoría reales). */
export interface CouponOrderItemInput {
  categoryId: string
  unitPrice: number
  quantity: number
}

/**
 * Valida un cupón para aplicarlo a una compra y calcula el descuento. A
 * diferencia de {@link validateCoupon}, también verifica el monto mínimo de
 * compra (siempre sobre el total del carrito) y el tope de usos.
 *
 * Cuando el cupón tiene `categoryId`, el descuento se calcula únicamente
 * sobre el subtotal de los ítems de esa categoría — no sobre todo el
 * carrito — y se rechaza si el carrito no tiene ningún ítem elegible.
 */
export async function validateCouponForOrder(
  code: string,
  items: CouponOrderItemInput[]
): Promise<CouponOrderValidation> {
  const coupon = await findCouponByCode(code.trim().toUpperCase())
  const now = new Date()

  if (!coupon || !coupon.isActive) {
    return { valid: false, reason: "Cupón no válido" }
  }
  if (coupon.validFrom > now || coupon.validUntil < now) {
    return { valid: false, reason: "El cupón está vencido o aún no es válido" }
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, reason: "El cupón alcanzó su límite de usos" }
  }

  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  const minOrder = coupon.minOrderAmount ? Number(coupon.minOrderAmount) : null
  if (minOrder !== null && subtotal < minOrder) {
    return {
      valid: false,
      reason: `El cupón requiere una compra mínima de $${minOrder.toLocaleString("es-CO")}`,
    }
  }

  const eligibleItems = coupon.categoryId
    ? items.filter((i) => i.categoryId === coupon.categoryId)
    : items
  if (coupon.categoryId && eligibleItems.length === 0) {
    return { valid: false, reason: "Este cupón no aplica a los productos de tu carrito" }
  }
  const eligibleSubtotal = eligibleItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  const discountValue = coupon.discountValue.toNumber()
  const rawDiscount =
    coupon.discountType === "PERCENTAGE" ? (eligibleSubtotal * discountValue) / 100 : discountValue
  // El descuento nunca supera el subtotal elegible (el total no puede quedar negativo)
  const discountAmount = Math.round(Math.min(rawDiscount, eligibleSubtotal))

  return {
    valid: true,
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType as "PERCENTAGE" | "FIXED_AMOUNT",
    discountValue,
    discountAmount,
  }
}

export async function couponCodeExists(code: string): Promise<boolean> {
  const coupon = await findCouponByCode(code)
  return !!coupon
}

export async function createCoupon(input: CouponInput): Promise<void> {
  await createCouponRecord({
    code: input.code,
    discountType: input.discountType as DiscountType,
    discountValue: input.discountValue,
    minOrderAmount: input.minOrderAmount ?? null,
    maxUses: input.maxUses ?? null,
    categoryId: input.categoryId ?? null,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    isActive: input.isActive ?? true,
  })
}

export async function toggleCouponActive(id: string, current: boolean): Promise<void> {
  await updateCouponRecord(id, { isActive: !current })
}

/** Registra un uso del cupón. Devuelve `false` si el tope ya estaba alcanzado. */
export async function registerCouponUsage(id: string): Promise<boolean> {
  return incrementCouponUsage(id)
}

/** Libera un uso reservado (p. ej. si la creación del pedido falló después de reservar). */
export async function releaseCouponUsage(id: string): Promise<void> {
  await updateCouponRecord(id, { usedCount: { decrement: 1 } })
}

/**
 * Libera el uso reservado por un pedido que finalmente no se pagó (rechazo,
 * vencimiento o cancelación). Silencioso si el código ya no existe.
 */
export async function releaseCouponUsageByCode(code: string): Promise<void> {
  const coupon = await findCouponByCode(code)
  if (!coupon) return
  await decrementCouponUsage(coupon.id)
}
