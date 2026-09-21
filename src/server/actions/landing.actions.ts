import "server-only"

import { revalidatePath } from "next/cache"
import type { Prisma, LandingSectionType } from "@prisma/client"
import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  createLandingSection,
  deleteLandingSection,
  setLandingSectionActive,
  updateLandingSectionConfig,
  updateLandingSectionPositions,
} from "@/server/services/landing-section.service"
import { ActiveStateSchema, EntityIdSchema } from "@/server/validators/common.validator"
import {
  LandingSectionConfigSchema,
  LandingSectionPositionsSchema,
  LandingSectionTypeSchema,
} from "@/server/validators/landing-section.validator"

function revalidateLanding() {
  revalidatePath("/")
  revalidatePath("/admin/landing-builder")
}

export async function updateLandingSectionPositionsAction(updates: { id: string; position: number }[]) {
  "use server"
  try {
    await requireSuperAdmin()
    await updateLandingSectionPositions(LandingSectionPositionsSchema.parse(updates))
    revalidateLanding()
    return { success: true }
  } catch (error) {
    console.error("Error updating landing section positions:", error)
    return { success: false, error: "No se pudo guardar el orden" }
  }
}

export async function toggleLandingSectionActiveAction(id: string, isActive: boolean) {
  "use server"
  try {
    await requireSuperAdmin()
    await setLandingSectionActive(
      EntityIdSchema.parse(id),
      ActiveStateSchema.parse(isActive),
    )
    revalidateLanding()
    return { success: true }
  } catch (error) {
    console.error("Error toggling landing section:", error)
    return { success: false, error: "No se pudo cambiar el estado" }
  }
}

export async function updateLandingSectionConfigAction(id: string, config: Prisma.InputJsonValue) {
  "use server"
  try {
    await requireSuperAdmin()
    const validId = EntityIdSchema.parse(id)
    const validConfig = LandingSectionConfigSchema.parse(config) as Prisma.InputJsonObject
    await updateLandingSectionConfig(validId, validConfig)
    revalidateLanding()
    return { success: true }
  } catch (error) {
    console.error("Error updating landing section config:", error)
    return { success: false, error: "No se pudo guardar la configuración" }
  }
}

export async function createLandingSectionAction(type: LandingSectionType) {
  "use server"
  try {
    await requireSuperAdmin()
    const validType = LandingSectionTypeSchema.parse(type)
    const newSection = await createLandingSection(validType)
    revalidateLanding()
    return { success: true, newSection }
  } catch (error) {
    console.error("Error creating landing section:", error)
    return { success: false, error: "No se pudo crear la sección" }
  }
}

export async function deleteLandingSectionAction(id: string) {
  "use server"
  try {
    await requireSuperAdmin()
    await deleteLandingSection(EntityIdSchema.parse(id))
    revalidateLanding()
    return { success: true }
  } catch (error) {
    console.error("Error deleting landing section:", error)
    return { success: false, error: "No se pudo eliminar la sección" }
  }
}
