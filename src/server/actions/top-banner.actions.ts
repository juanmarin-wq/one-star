import "server-only"

import { updateTopBanner } from "@/server/services/top-banner.service"
import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import { getActionError } from "@/server/actions/action-error"
import { TopBannerInputSchema } from "@/server/validators/top-banner.validator"

export interface TopBannerMessageInput {
  text: string
  url?: string
}

export async function updateTopBannerAction(data: {
  text: string
  btnText?: string | null
  btnUrl?: string | null
  messages?: TopBannerMessageInput[]
  bgColor: string
  textColor: string
  isActive: boolean
}) {
  "use server"
  try {
    await requireSuperAdmin()
    const input = TopBannerInputSchema.parse(data)
    const updated = await updateTopBanner(input)
    revalidatePath("/admin/landing-builder")
    revalidatePath("/", "layout")
    return { success: true, data: updated }
  } catch (error: unknown) {
    console.error("Error updating top banner:", error)
    const message = getActionError(error, "Error al actualizar el banner")
    return { success: false, error: message }
  }
}
