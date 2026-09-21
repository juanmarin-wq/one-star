import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import AdminSidebar from "@/components/admin/AdminSidebar"
import AdminHotkeys from "@/components/admin/AdminHotkeys"

// El panel admin depende de la base de datos y de la sesión: nunca debe
// pre-generarse en build (cuando no hay DB). Forzamos render dinámico.
export const dynamic = "force-dynamic"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const reqHeaders = await headers()

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null
  try {
    session = await auth.api.getSession({ headers: reqHeaders })
  } catch {
    // Auth failure — proxy.ts will redirect unauthenticated requests
  }

  const isAdmin = session && (session.user as { userType?: string }).userType === "admin"

  // Without a valid admin session just pass children through.
  // proxy.ts enforces the redirect to /admin/login for protected routes;
  // the login page itself must render without the admin chrome while keeping
  // the main landmark that PublicSiteFrame intentionally omits for /admin.
  if (!isAdmin) {
    return <main className="flex-1">{children}</main>
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-[#F5F5F5]">
      <AdminSidebar
        userName={session!.user.name ?? "Admin"}
        userRole={
          (session!.user as { adminRole?: string | null }).adminRole === "INVENTORY_OPERATOR"
            ? "INVENTORY_OPERATOR"
            : "SUPER_ADMIN"
        }
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <AdminHotkeys />
    </div>
  )
}
