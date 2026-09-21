import "server-only"

import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  createNavigationItem,
  deleteNavigationItem,
  setNavigationItemActive,
  updateNavigationItem,
  updateNavigationPositions,
} from "@/server/services/navigation.service"
import { getActionError } from "@/server/actions/action-error"
import { ActiveStateSchema, EntityIdSchema } from "@/server/validators/common.validator"
import {
  NavigationItemInputSchema,
  NavigationPositionsSchema,
} from "@/server/validators/navigation.validator"

function revalidateNavigation() {
  revalidatePath("/admin/landing-builder")
  revalidatePath("/")
}

export async function createNavigationItemAction(label: string, href: string, isSale: boolean) {
  "use server"
  try {
    await requireSuperAdmin()
    const input = NavigationItemInputSchema.parse({ label, href, isSale })
    const item = await createNavigationItem(input)
    revalidateNavigation()
    return { success: true, data: item }
  } catch (error) {
    console.error("Error creating nav item:", error)
    return { success: false, error: getActionError(error, "Error al crear el enlace") }
  }
}

export async function updateNavigationItemAction(id: string, label: string, href: string, isSale: boolean) {
  "use server"
  try {
    await requireSuperAdmin()
    const validId = EntityIdSchema.parse(id)
    const input = NavigationItemInputSchema.parse({ label, href, isSale })
    await updateNavigationItem(validId, input)
    revalidateNavigation()
    return { success: true }
  } catch (error) {
    console.error("Error updating nav item:", error)
    return { success: false, error: getActionError(error, "Error al actualizar el enlace") }
  }
}

export async function deleteNavigationItemAction(id: string) {
  "use server"
  try {
    await requireSuperAdmin()
    await deleteNavigationItem(EntityIdSchema.parse(id))
    revalidateNavigation()
    return { success: true }
  } catch (error) {
    console.error("Error deleting nav item:", error)
    return { success: false, error: "Error al eliminar el enlace" }
  }
}

export async function updateNavigationPositionsAction(updates: { id: string; position: number }[]) {
  "use server"
  try {
    await requireSuperAdmin()
    await updateNavigationPositions(NavigationPositionsSchema.parse(updates))
    revalidateNavigation()
    return { success: true }
  } catch (error) {
    console.error("Error updating nav positions:", error)
    return { success: false, error: "No se pudo guardar el orden" }
  }
}

export async function toggleNavigationItemActiveAction(id: string, isActive: boolean) {
  "use server"
  try {
    await requireSuperAdmin()
    await setNavigationItemActive(
      EntityIdSchema.parse(id),
      ActiveStateSchema.parse(isActive),
    )
    revalidateNavigation()
    return { success: true }
  } catch (error) {
    console.error("Error toggling nav item:", error)
    return { success: false, error: "No se pudo cambiar el estado" }
  }
}
