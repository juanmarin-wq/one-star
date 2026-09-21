"use client"

import { useState } from "react"
import Link from "next/link"
import {
  testErpConnectionAction,
  previewErpConnectionAction,
  linkManualProductsAction,
} from "./actions"
import type { ErpConnectionPreview, ErpConnectionMatch } from "@/server/services/erp-connection-assistant.service"

type Step = "credenciales" | "revision" | "final"

const ENV_VAR_BY_PROVIDER: Record<string, string[]> = {
  loggro: ["ERP_PROVIDER=loggro", "LOGGRO_API_TOKEN=<tu-token>"],
  alegra: ["ERP_PROVIDER=alegra", "ALEGRA_EMAIL=<tu-email>", "ALEGRA_API_KEY=<tu-api-key>"],
}

export default function ConectarErpPage() {
  const [step, setStep] = useState<Step>("credenciales")
  const [provider, setProvider] = useState("loggro")
  const [apiToken, setApiToken] = useState("")
  const [email, setEmail] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ErpConnectionPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, boolean>>({}) // erpId -> vincular?
  const [linkedCount, setLinkedCount] = useState(0)

  const credentials = provider === "loggro" ? { apiToken } : { email, apiKey }

  async function handleTestAndPreview() {
    setLoading(true)
    setError(null)
    const test = await testErpConnectionAction(provider, credentials)
    if (!test.success) {
      setLoading(false)
      setError(test.error ?? "No se pudo conectar.")
      return
    }
    const result = await previewErpConnectionAction(provider, credentials)
    setLoading(false)
    if ("error" in result) {
      setError(result.error)
      return
    }
    setPreview(result)
    setDecisions(Object.fromEntries(result.matches.map((m) => [m.erpGroup.erpId, false])))
    setStep("revision")
  }

  async function handleConfirmDecisions() {
    if (!preview) return
    setLoading(true)
    const toLink = preview.matches
      .filter((m) => decisions[m.erpGroup.erpId])
      .map((m) => ({ productId: m.manualProduct.id, erpBaseSku: m.erpGroup.sku }))
    const result = await linkManualProductsAction(toLink)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? "No se pudieron vincular los productos.")
      return
    }
    setLinkedCount(result.linkedCount)
    setStep("final")
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Conectar un ERP</h1>
        <Link href="/admin/integraciones" className="text-sm text-gray-600 hover:underline">
          Volver a Integraciones
        </Link>
      </div>

      <p className="mb-6 text-sm text-gray-600">
        Este asistente prueba las credenciales y revisa si el catálogo del ERP se parece a
        productos que ya cargaste a mano — para que la conexión real no los duplique. No guarda
        nada ni activa el ERP por sí solo: al final te da el valor exacto para pegar en el
        servidor.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
      )}

      {step === "credenciales" && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Proveedor</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="loggro">Loggro</option>
              <option value="alegra">Alegra</option>
            </select>
          </div>

          {provider === "loggro" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">Token de Loggro</label>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Email de Alegra</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">API Key de Alegra</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={handleTestAndPreview}
            disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Probando..." : "Probar conexión y revisar catálogo"}
          </button>
        </div>
      )}

      {step === "revision" && preview && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-700">
              <strong>{preview.newCount}</strong> producto(s) nuevo(s) que se crearán tal cual, y{" "}
              <strong>{preview.matches.length}</strong> posible(s) duplicado(s) con productos que ya cargaste a
              mano.
            </p>
          </div>

          {preview.matches.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
              <p className="mb-3 text-sm text-amber-900">
                Elige para cada uno: <strong>Vincular</strong> (el producto manual pasa a ser actualizado por el
                ERP — su URL pública va a cambiar) o <strong>Dejar separados</strong> (ambos quedan en el
                catálogo).
              </p>
              <div className="space-y-3">
                {preview.matches.map((m: ErpConnectionMatch) => (
                  <div key={m.erpGroup.erpId} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <div className="mb-2">
                      <strong>{m.manualProduct.name}</strong> (manual, /productos/{m.manualProduct.slug}) ≈ ERP{" "}
                      <strong>{m.erpGroup.name}</strong> (código {m.erpGroup.sku})
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={decisions[m.erpGroup.erpId] ?? false}
                        onChange={(e) =>
                          setDecisions((prev) => ({ ...prev, [m.erpGroup.erpId]: e.target.checked }))
                        }
                      />
                      Vincular (cambia la URL a /productos/{m.erpGroup.sku})
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirmDecisions}
            disabled={loading}
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Guardando..." : "Confirmar y continuar"}
          </button>
        </div>
      )}

      {step === "final" && (
        <div className="space-y-4 rounded-lg border border-green-200 bg-green-50 p-5">
          <p className="text-sm text-green-900">
            {linkedCount > 0
              ? `${linkedCount} producto(s) vinculado(s). `
              : ""}
            Todo listo. Para activar el ERP de verdad, pega esto en el <code>.env</code> del servidor y reinicia
            el contenedor:
          </p>
          <pre className="rounded-lg bg-gray-900 p-3 text-xs text-white">
            {(ENV_VAR_BY_PROVIDER[provider] ?? []).join("\n")}
          </pre>
          <p className="text-sm text-green-900">
            Reinicio: <code>docker compose up -d</code> en el servidor. Las credenciales que escribiste aquí no se
            guardaron en ningún lado — solo se usaron para esta prueba.
          </p>
        </div>
      )}
    </div>
  )
}
