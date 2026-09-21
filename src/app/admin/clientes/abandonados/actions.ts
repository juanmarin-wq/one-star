"use server"

import { revalidatePath } from "next/cache"
import { recoverAbandonedCart } from "@/server/services/abandoned-cart.service"
import { requireSuperAdmin } from "@/server/auth/require-admin"

export async function markCartRecovered(
  cartId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin()
    await recoverAbandonedCart(cartId)
    revalidatePath("/admin/clientes/abandonados")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[markCartRecovered]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: "No se pudo marcar como recuperado." }
  }
}
