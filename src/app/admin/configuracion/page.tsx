import { requireSuperAdmin } from "@/server/auth/require-admin"
import { getStoreSettings } from "@/server/services/store-settings.service"
import StoreInfoForm from "@/components/admin/StoreInfoForm"

export const dynamic = "force-dynamic"

export default async function ConfiguracionPage() {
  await requireSuperAdmin()
  const settings = await getStoreSettings()

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <h1 className="font-['Barlow',sans-serif] text-2xl font-bold text-[#1C1C1C] mb-6">
        Configuración
      </h1>
      <StoreInfoForm settings={settings} />
    </div>
  )
}
