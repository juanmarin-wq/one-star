import { describe, expect, it } from "vitest"
import { canAccessAdminPath, normalizeAdminRole } from "@/lib/admin-access"

describe("canAccessAdminPath", () => {
  it("SUPER_ADMIN entra a todo", () => {
    expect(canAccessAdminPath("SUPER_ADMIN", "/admin/cupones")).toBe(true)
    expect(canAccessAdminPath("SUPER_ADMIN", "/admin/clientes/abc")).toBe(true)
  })

  it("INVENTORY_OPERATOR entra a inventario, pedidos y sus subrutas", () => {
    for (const p of [
      "/admin",
      "/admin/pedidos",
      "/admin/pedidos/ped_1",
      "/admin/productos",
      "/admin/productos/importar",
      "/admin/productos/abc/editar",
      "/admin/categorias",
      "/admin/marcas",
      "/admin/colores/",
    ]) {
      expect(canAccessAdminPath("INVENTORY_OPERATOR", p), p).toBe(true)
    }
  })

  it("INVENTORY_OPERATOR no entra a lo demás, incluidas páginas nuevas", () => {
    for (const p of [
      "/admin/cupones",
      "/admin/clientes",
      "/admin/clientes/abc",
      "/admin/archivos",
      "/admin/tiendas",
      "/admin/tarjetas-regalo",
      "/admin/integraciones/conectar-erp",
      "/admin/pagina-futura",
      "/admin/productosx",
    ]) {
      expect(canAccessAdminPath("INVENTORY_OPERATOR", p), p).toBe(false)
    }
  })
})

describe("normalizeAdminRole", () => {
  it("solo INVENTORY_OPERATOR es limitado; lo demás conserva SUPER_ADMIN", () => {
    expect(normalizeAdminRole("INVENTORY_OPERATOR")).toBe("INVENTORY_OPERATOR")
    expect(normalizeAdminRole(null)).toBe("SUPER_ADMIN")
    expect(normalizeAdminRole(undefined)).toBe("SUPER_ADMIN")
  })
})
