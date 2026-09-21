import "server-only"

import { revalidatePath } from "next/cache"
import {
  createGridBlock as createGridBlockService,
  updateGridBlock as updateGridBlockService,
  deleteGridBlock as deleteGridBlockService,
} from "@/server/services/home-grid.service"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import { getActionError } from "@/server/actions/action-error"
import { ActiveStateSchema, EntityIdSchema } from "@/server/validators/common.validator"
import { HomeGridBlockSchema } from "@/server/validators/home-grid.validator"

function parseForm(formData: FormData) {
  return {
    label: formData.get("label") as string,
    href: formData.get("href") as string,
    bgColor: formData.get("bgColor") as string,
    emoji: (formData.get("emoji") as string) || null,
    darkText: formData.get("darkText") === "true",
    position: formData.get("position") ? Number(formData.get("position")) : 0,
    isActive: formData.get("isActive") === "true",
  }
}

export async function createGridBlock(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    const input = HomeGridBlockSchema.parse(parseForm(formData))
    await createGridBlockService(input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/") // revalidate storefront
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[createGridBlock]", error)
    }
    return { success: false, error: getActionError(error, "Error al crear el bloque.") }
  }
}

export async function updateGridBlock(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    const validId = EntityIdSchema.parse(id)
    const input = HomeGridBlockSchema.parse(parseForm(formData))
    await updateGridBlockService(validId, input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[updateGridBlock]", error)
    }
    return { success: false, error: getActionError(error, "Error al actualizar el bloque.") }
  }
}

export async function deleteGridBlock(
  id: string
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    await deleteGridBlockService(EntityIdSchema.parse(id))
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[deleteGridBlock]", error)
    }
    return { success: false, error: "Error al eliminar el bloque." }
  }
}

export async function toggleGridBlockActive(
  id: string,
  current: boolean
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    const validId = EntityIdSchema.parse(id)
    const validCurrent = ActiveStateSchema.parse(current)
    await updateGridBlockService(validId, { isActive: !validCurrent })
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[toggleGridBlockActive]", error)
    }
    return { success: false, error: "Error al cambiar el estado." }
  }
}
