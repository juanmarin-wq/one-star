import "server-only"
import type { IERPAdapter } from "./ports/erp.port"

/**
 * Único punto (fuera de `erp.container.ts`) donde se permite instanciar un
 * adaptador concreto directamente, con credenciales arbitrarias en memoria —
 * usado exclusivamente por el asistente de conexión para PROBAR un ERP antes
 * de activarlo de verdad vía `ERP_PROVIDER` en el entorno. Nunca reemplaza al
 * contenedor global (`getERPAdapter`), que sigue siendo la única fuente de
 * verdad del ERP realmente activo en producción.
 */
export interface ErpCredentials {
  /** Loggro */
  apiToken?: string
  /** Alegra */
  email?: string
  apiKey?: string
}

export function createAdapterFromCredentials(provider: string, credentials: ErpCredentials): IERPAdapter {
  switch (provider) {
    case "loggro": {
      if (!credentials.apiToken?.trim()) {
        throw new Error("Falta el token de Loggro.")
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { LoggroERPAdapter } = require("./adapters/loggro.adapter") as {
        LoggroERPAdapter: new (token: string) => IERPAdapter
      }
      return new LoggroERPAdapter(credentials.apiToken.trim())
    }
    case "alegra": {
      if (!credentials.email?.trim() || !credentials.apiKey?.trim()) {
        throw new Error("Faltan el email y la API key de Alegra.")
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AlegraERPAdapter } = require("./adapters/alegra.adapter") as {
        AlegraERPAdapter: new (email: string, apiKey: string) => IERPAdapter
      }
      return new AlegraERPAdapter(credentials.email.trim(), credentials.apiKey.trim())
    }
    default:
      throw new Error(`Proveedor "${provider}" no soportado.`)
  }
}
