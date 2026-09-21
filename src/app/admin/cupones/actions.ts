"use server"

import { revalidatePath } from "next/cache"
import {
  createCoupon as createCouponService,
  toggleCouponActive as toggleCouponActiveService,
  couponCodeExists,
} from "@/server/services/coupon.service"
import { requireSuperAdmin } from "@/server/auth/require-admin"

export async function createCoupon(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin()
  } catch {
    return { success: false, error: "No autorizado." }
  }
  const code = (formData.get("code") as string).toUpperCase().trim()
  const discountType = formData.get("discountType") as string
  const discountValue = parseFloat(formData.get("discountValue") as string)
  const minOrderAmountRaw = formData.get("minOrderAmount") as string
  const maxUsesRaw = formData.get("maxUses") as string
  const categoryIdRaw = formData.get("categoryId") as string
  const validFrom = new Date(formData.get("validFrom") as string)
  const validUntil = new Date(formData.get("validUntil") as string)
  const isActive = formData.get("isActive") === "true"

  if (!code || !discountType || isNaN(discountValue)) {
    return { success: false, error: "Código, tipo y valor son obligatorios." }
  }

  try {
    const exists = await couponCodeExists(code)
    if (exists) {
      return { success: false, error: "Ya existe un cupón con ese código." }
    }

    await createCouponService({
      code,
      discountType,
      discountValue,
      minOrderAmount: minOrderAmountRaw ? parseFloat(minOrderAmountRaw) : null,
      maxUses: maxUsesRaw ? parseInt(maxUsesRaw) : null,
      categoryId: categoryIdRaw || null,
      validFrom,
      validUntil,
      isActive,
    })
    revalidatePath("/admin/cupones")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[createCoupon]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: "Error al crear el cupón." }
  }
}

export async function toggleCouponActive(
  id: string,
  current: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin()
    await toggleCouponActiveService(id, current)
    revalidatePath("/admin/cupones")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[toggleCouponActive]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: "Error al cambiar el estado." }
  }
}
