import Link from "next/link"
import { getErpSyncStatus } from "@/server/services/erp-sync.service"
import { getStoreSettings } from "@/server/services/store-settings.service"
import { getAdminSession } from "@/server/auth/require-admin"
import SyncPanel from "@/components/admin/SyncPanel"
import MetaPixelSettingsForm from "@/components/admin/MetaPixelSettingsForm"
import { erpSyncScheduleSnapshotKey } from "@/lib/erp-sync-schedule"

// Datos en vivo (estado del ERP + historial): nunca pre-generar.
export const dynamic = "force-dynamic"

export default async function IntegrationsPage() {
  // Defensa en profundidad: el layout/proxy protegen /admin, pero esta página
  // expone estado del ERP, así que verificamos la sesión de admin aquí también.
  const session = await getAdminSession()
  if (!session) {
    return <div className="p-8 text-gray-600">No autorizado.</div>
  }

  const [status, settings] = await Promise.all([getErpSyncStatus(), getStoreSettings()])
  return (
    <>
      <SyncPanel
        key={`${erpSyncScheduleSnapshotKey({
          enabled: status.autoSyncEnabled,
          intervalMinutes: status.autoSyncMinutes,
          nextRunAt: status.nextAutoSyncAt,
        })}:${status.catalogSyncAvailable ? "catalog" : "no-catalog"}`}
        initialStatus={status}
      />
      <div className="mx-auto max-w-5xl px-6 pb-6 sm:px-8">
        <Link
          href="/admin/integraciones/conectar-erp"
          className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Conectar un ERP (probar credenciales + revisar duplicados)
        </Link>
      </div>
      <div className="mx-auto max-w-5xl px-6 pb-10 sm:px-8">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-[#1C1C1C]">Marketing</h2>
        <MetaPixelSettingsForm settings={settings} />
      </div>
    </>
  )
}
