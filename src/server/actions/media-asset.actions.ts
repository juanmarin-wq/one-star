"use server"

import { revalidatePath } from "next/cache"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  getMediaAssets,
  deleteMediaAsset,
  autoSyncExistingAssets,
  type MediaAssetDTO,
} from "@/server/services/media-asset.service"

export async function getMediaAssetsAction(options?: {
  fileType?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<{ success: boolean; data?: { items: MediaAssetDTO[]; total: number }; error?: string }> {
  try {
    await requireSuperAdmin()
    const data = await getMediaAssets(options)
    return { success: true, data }
  } catch (error) {
    console.error("[getMediaAssetsAction] Error:", error)
    return { success: false, error: "No se pudieron obtener los archivos." }
  }
}

export async function deleteMediaAssetAction(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin()
    await deleteMediaAsset(id)
    revalidatePath("/admin/archivos")
    return { success: true }
  } catch (error) {
    console.error("[deleteMediaAssetAction] Error:", error)
    return { success: false, error: "No se pudo eliminar el archivo." }
  }
}

export async function syncMediaAssetsAction(): Promise<{ success: boolean; synced?: number; error?: string }> {
  try {
    await requireSuperAdmin()
    const synced = await autoSyncExistingAssets()
    revalidatePath("/admin/archivos")
    return { success: true, synced }
  } catch (error) {
    console.error("[syncMediaAssetsAction] Error:", error)
    return { success: false, error: "Error al sincronizar archivos existentes." }
  }
}
