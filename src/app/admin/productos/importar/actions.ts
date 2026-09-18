"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/server/auth/require-admin"
import {
  previewProductImport,
  applyProductImport,
  type ProductImportPreview,
  type ProductImportApplyResult,
} from "@/server/services/product-import.service"

export interface ImportActionResult<T> {
  success: boolean
  data?: T
  error?: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error inesperado al procesar el archivo."
}

export async function previewProductImportAction(
  formData: FormData
): Promise<ImportActionResult<ProductImportPreview>> {
  try {
    await requireAdmin()
    const file = formData.get("file")
    if (!file || !(file instanceof File)) {
      return { success: false, error: "No se recibió ningún archivo." }
    }
    const buffer = await file.arrayBuffer()
    const preview = await previewProductImport(buffer)
    return { success: true, data: preview }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function applyProductImportAction(
  formData: FormData
): Promise<ImportActionResult<ProductImportApplyResult>> {
  try {
    await requireAdmin()
    const file = formData.get("file")
    const fingerprint = formData.get("fingerprint")
    if (!file || !(file instanceof File)) {
      return { success: false, error: "No se recibió ningún archivo." }
    }
    if (typeof fingerprint !== "string" || fingerprint.length === 0) {
      return { success: false, error: "Falta la vista previa — vuelve a subir el archivo." }
    }
    const buffer = await file.arrayBuffer()
    const result = await applyProductImport(buffer, fingerprint)

    revalidatePath("/admin/productos")
    revalidatePath("/productos")

    return { success: true, data: result }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
