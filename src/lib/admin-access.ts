export type AdminRole = "SUPER_ADMIN" | "INVENTORY_OPERATOR"

/** Único alcance de "Operador de Inventario" — todo lo demás requiere Super Admin. */
export const INVENTORY_OPERATOR_HREFS: ReadonlySet<string> = new Set([
  "/admin",
  "/admin/pedidos",
  "/admin/productos",
  "/admin/productos/importar",
  "/admin/categorias",
  "/admin/marcas",
  "/admin/colores",
])

/**
 * Regla central de acceso a páginas del admin: lista blanca, así que una
 * página nueva queda restringida a Super Admin hasta que se agregue aquí.
 * "/admin" solo coincide exacto; las demás incluyen sus subrutas
 * (p. ej. /admin/productos/abc123/editar).
 */
export function canAccessAdminPath(role: AdminRole, pathname: string): boolean {
  if (role === "SUPER_ADMIN") return true
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (path === "/admin") return true
  for (const href of INVENTORY_OPERATOR_HREFS) {
    if (href === "/admin") continue
    if (path === href || path.startsWith(`${href}/`)) return true
  }
  return false
}

export function normalizeAdminRole(role: string | null | undefined): AdminRole {
  return role === "INVENTORY_OPERATOR" ? "INVENTORY_OPERATOR" : "SUPER_ADMIN"
}
