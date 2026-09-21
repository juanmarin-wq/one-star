"use server"

import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  createStore,
  deleteStore,
  setStoreActive,
  updateStore,
} from "@/server/services/store.service"
import { storeLocationSchema } from "@/server/validators/store-location.validator"

function revalidateStores() {
  revalidatePath("/admin/tiendas")
  revalidatePath("/tiendas")
  // La ficha de producto muestra la disponibilidad por sede.
  revalidatePath("/productos/[slug]", "page")
}

function isUniqueErpLinkError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  )
}

export async function createStoreAction(data: unknown) {
  try {
    await requireSuperAdmin()
    const parsed = storeLocationSchema.safeParse(data)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
    }
    await createStore(parsed.data)
    revalidateStores()
    return { success: true }
  } catch (error) {
    console.error("Error creating store:", error)
    if (isUniqueErpLinkError(error)) {
      return { success: false, error: "Esa sede del ERP ya está vinculada a otra sucursal." }
    }
    return { success: false, error: "Error al crear la sucursal" }
  }
}

export async function updateStoreAction(id: string, data: unknown) {
  try {
    await requireSuperAdmin()
    const parsed = storeLocationSchema.safeParse(data)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
    }
    await updateStore(id, parsed.data)
    revalidateStores()
    return { success: true }
  } catch (error) {
    console.error("Error updating store:", error)
    if (isUniqueErpLinkError(error)) {
      return { success: false, error: "Esa sede del ERP ya está vinculada a otra sucursal." }
    }
    return { success: false, error: "Error al actualizar la sucursal" }
  }
}

export async function deleteStoreAction(id: string) {
  try {
    await requireSuperAdmin()
    await deleteStore(id)
    revalidateStores()
    return { success: true }
  } catch (error) {
    console.error("Error deleting store:", error)
    return { success: false, error: "Error al eliminar la sucursal" }
  }
}

export async function toggleStoreActiveAction(id: string, isActive: boolean) {
  try {
    await requireSuperAdmin()
    await setStoreActive(id, isActive)
    revalidateStores()
    return { success: true }
  } catch (error) {
    console.error("Error toggling store:", error)
    return { success: false, error: "Error al cambiar el estado de la sucursal" }
  }
}
