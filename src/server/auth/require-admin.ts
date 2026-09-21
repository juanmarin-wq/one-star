import "server-only"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"

/**
 * Error de autorización. Se lanza cuando quien invoca una Server Action o ruta
 * protegida no es un administrador. Los callers pueden distinguirlo del resto
 * de errores mediante `instanceof UnauthorizedError`.
 */
export class UnauthorizedError extends Error {
  constructor(message = "No autorizado.") {
    super(message)
    this.name = "UnauthorizedError"
  }
}

/**
 * Defensa en profundidad para las Server Actions y rutas de administración.
 *
 * Las Server Actions son endpoints HTTP públicos: cualquiera puede invocarlas
 * conociendo su ID, por lo que NO basta con el middleware (`proxy.ts`) que solo
 * filtra por ruta. Toda mutación de admin DEBE verificar la sesión aquí.
 *
 * Lanza {@link UnauthorizedError} si no hay sesión de administrador.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userType = (session?.user as { userType?: string } | undefined)?.userType
  if (!session || userType !== "admin") {
    throw new UnauthorizedError()
  }
  return session
}

/**
 * Igual que {@link requireAdmin} pero devuelve la sesión o `null` en vez de
 * lanzar. Útil en callers que ya usan el patrón `{ success, error }`.
 */
export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userType = (session?.user as { userType?: string } | undefined)?.userType
  return session && userType === "admin" ? session : null
}

export type AdminRole = "SUPER_ADMIN" | "INVENTORY_OPERATOR"

/**
 * Rol del admin autenticado, o `null` si no hay sesión de admin. Una sesión
 * de admin sin `adminRole` migrado (creada antes de este campo) se trata
 * como `SUPER_ADMIN` — nunca se bloquea por accidente a un admin ya activo.
 */
export async function getAdminRole(): Promise<AdminRole | null> {
  const session = await getAdminSession()
  if (!session) return null
  const role = (session.user as { adminRole?: string | null }).adminRole
  return role === "INVENTORY_OPERATOR" ? "INVENTORY_OPERATOR" : "SUPER_ADMIN"
}

/**
 * Como {@link requireAdmin}, pero además exige rol `SUPER_ADMIN`. Úsalo en
 * toda Server Action fuera del alcance de "Operador de Inventario"
 * (catálogo, importación de productos, pedidos son las únicas excepciones).
 */
export async function requireSuperAdmin() {
  const session = await requireAdmin()
  const role = (session.user as { adminRole?: string | null }).adminRole
  if (role === "INVENTORY_OPERATOR") {
    throw new UnauthorizedError("Esta acción requiere el rol Super Admin.")
  }
  return session
}
