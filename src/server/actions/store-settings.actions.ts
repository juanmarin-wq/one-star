"use server"

import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  updateMetaPixelSettings,
  updateStoreInfo,
} from "@/server/services/store-settings.service"
import {
  MetaPixelInputSchema,
  StoreInfoInputSchema,
} from "@/server/validators/store-settings.validator"

export interface StoreSettingsActionResult {
  success: boolean
  error?: string
}

function firstIssueMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ message: string }> }).issues
    if (issues[0]?.message) return issues[0].message
  }
  return error instanceof Error ? error.message : fallback
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "")
const checkbox = (formData: FormData, key: string) => formData.get(key) === "on"

export async function updateStoreInfoAction(
  formData: FormData,
): Promise<StoreSettingsActionResult> {
  try {
    await requireSuperAdmin()
    const input = StoreInfoInputSchema.parse({
      storeName: text(formData, "storeName"),
      contactEmail: text(formData, "contactEmail").trim(),
      whatsapp: text(formData, "whatsapp"),
    })
    await updateStoreInfo(input)
    revalidatePath("/admin/configuracion")
    revalidatePath("/", "layout")
    return { success: true }
  } catch (error: unknown) {
    console.error("[store-settings] updateStoreInfoAction:", error)
    return { success: false, error: firstIssueMessage(error, "No se pudo guardar la configuración") }
  }
}

export async function updateMetaPixelAction(
  formData: FormData,
): Promise<StoreSettingsActionResult> {
  try {
    await requireSuperAdmin()
    const input = MetaPixelInputSchema.parse({
      enabled: checkbox(formData, "enabled"),
      pixelId: text(formData, "pixelId").trim(),
      accessToken: text(formData, "accessToken").trim(),
      clearAccessToken: checkbox(formData, "clearAccessToken"),
      testEventCode: text(formData, "testEventCode").trim(),
    })
    await updateMetaPixelSettings(input)
    revalidatePath("/admin/integraciones")
    // El píxel se inyecta desde el layout raíz: hay que regenerarlo.
    revalidatePath("/", "layout")
    return { success: true }
  } catch (error: unknown) {
    console.error("[store-settings] updateMetaPixelAction:", error)
    return { success: false, error: firstIssueMessage(error, "No se pudo guardar el píxel de Meta") }
  }
}
