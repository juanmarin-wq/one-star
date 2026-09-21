import "server-only"

import { revalidatePath } from "next/cache"
import {
  createBanner as createBannerService,
  updateBanner as updateBannerService,
  deleteBanner as deleteBannerService,
  toggleBannerActive as toggleBannerActiveService,
} from "@/server/services/banner.service"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import { getActionError } from "@/server/actions/action-error"
import { BannerInputSchema } from "@/server/validators/banner.validator"
import { ActiveStateSchema, EntityIdSchema } from "@/server/validators/common.validator"

function parseBannerForm(formData: FormData) {
  const requestedMediaType = formData.get("mediaType")
  return {
    title: formData.get("title") as string,
    imageUrl: formData.get("imageUrl") as string,
    mediaType: requestedMediaType === "video" ? "video" as const : "image" as const,
    linkUrl: (formData.get("linkUrl") as string) || null,
    position: formData.get("position") ? Number(formData.get("position")) : 0,
    isActive: formData.get("isActive") === "true",
    startDate: (formData.get("startDate") as string) || null,
    endDate: (formData.get("endDate") as string) || null,
  }
}

export async function createBanner(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    const input = BannerInputSchema.parse(parseBannerForm(formData))
    await createBannerService(input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[createBanner]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: getActionError(error, "Error al crear el banner.") }
  }
}

export async function updateBanner(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    const validId = EntityIdSchema.parse(id)
    const input = BannerInputSchema.parse(parseBannerForm(formData))
    await updateBannerService(validId, input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[updateBanner]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: getActionError(error, "Error al actualizar el banner.") }
  }
}

export async function deleteBanner(
  id: string
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    await deleteBannerService(EntityIdSchema.parse(id))
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[deleteBanner]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: "Error al eliminar el banner." }
  }
}

export async function toggleBannerActive(
  id: string,
  current: boolean
): Promise<{ success: boolean; error?: string }> {
  "use server"
  try {
    await requireSuperAdmin()
    await toggleBannerActiveService(
      EntityIdSchema.parse(id),
      ActiveStateSchema.parse(current),
    )
    revalidatePath("/admin/landing-builder")
    revalidatePath("/")
    return { success: true }
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[toggleBannerActive]", error instanceof Error ? error.message : error)
    }
    return { success: false, error: "Error al cambiar el estado." }
  }
}
