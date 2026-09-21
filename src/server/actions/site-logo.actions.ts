import "server-only"

import { 
  addStoreLogo, 
  deleteStoreLogo, 
  setPrimaryStoreLogo, 
  updateStoreLogoTheme
} from "@/server/services/site-logo.service"
import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import { getActionError } from "@/server/actions/action-error"
import { EntityIdSchema } from "@/server/validators/common.validator"
import {
  StoreLogoInputSchema,
  StoreLogoThemeSchema,
  StoreLogoTypeSchema,
} from "@/server/validators/site-logo.validator"

export async function addStoreLogoAction(data: {
  url: string
  fileName?: string
  type: string
  theme: string
  isPrimary: boolean
}) {
  "use server"
  try {
    await requireSuperAdmin()
    const input = StoreLogoInputSchema.parse(data)
    const newLogo = await addStoreLogo(input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/", "layout")
    return { success: true, data: newLogo }
  } catch (error: unknown) {
    console.error("Error adding store logo:", error)
    const message = getActionError(error, "Error al subir logo")
    return { success: false, error: message }
  }
}

export async function setPrimaryStoreLogoAction(id: string, type: string) {
  "use server"
  try {
    await requireSuperAdmin()
    await setPrimaryStoreLogo(
      EntityIdSchema.parse(id),
      StoreLogoTypeSchema.parse(type),
    )
    revalidatePath("/admin/landing-builder")
    revalidatePath("/", "layout")
    return { success: true }
  } catch (error: unknown) {
    console.error("Error setting primary logo:", error)
    const message = error instanceof Error ? error.message : "Error al establecer logo principal"
    return { success: false, error: message }
  }
}

export async function updateStoreLogoThemeAction(id: string, theme: string) {
  "use server"
  try {
    await requireSuperAdmin()
    await updateStoreLogoTheme(
      EntityIdSchema.parse(id),
      StoreLogoThemeSchema.parse(theme),
    )
    revalidatePath("/admin/landing-builder")
    revalidatePath("/", "layout")
    return { success: true }
  } catch (error: unknown) {
    console.error("Error updating logo theme:", error)
    const message = error instanceof Error ? error.message : "Error al cambiar el tema"
    return { success: false, error: message }
  }
}

export async function deleteStoreLogoAction(id: string) {
  "use server"
  try {
    await requireSuperAdmin()
    await deleteStoreLogo(EntityIdSchema.parse(id))
    revalidatePath("/admin/landing-builder")
    revalidatePath("/", "layout")
    return { success: true }
  } catch (error: unknown) {
    console.error("Error deleting store logo:", error)
    const message = error instanceof Error ? error.message : "Error al eliminar logo"
    return { success: false, error: message }
  }
}
