"use client"

import { useState } from "react"
import { searchGiftCardAction, redeemGiftCardAction } from "./actions"
import type { GiftCardLookupResult } from "@/server/services/gift-card.service"

export default function TarjetasRegaloPage() {
  const [code, setCode] = useState("")
  const [card, setCard] = useState<GiftCardLookupResult | null>(null)
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSearch() {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    setMessage(null)
    const res = await searchGiftCardAction(code)
    setLoading(false)
    if (!res.success || !res.data) {
      setError(res.error ?? "No se pudo buscar el código.")
      setCard(null)
      return
    }
    setCard(res.data)
  }

  async function handleRedeem() {
    const numericAmount = Number(amount)
    if (!code.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) return
    setLoading(true)
    setError(null)
    setMessage(null)
    const res = await redeemGiftCardAction(code, numericAmount)
    setLoading(false)
    if (!res.success || !res.data) {
      setError(res.error ?? "No se pudo canjear el monto.")
      return
    }
    setCard(res.data)
    setAmount("")
    setMessage(`Se descontaron $${numericAmount.toLocaleString("es-CO")}. Saldo restante: $${res.data.balance.toLocaleString("es-CO")}.`)
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">Tarjetas de regalo</h1>
      <p className="mb-6 text-sm text-gray-600">
        Busca un código para ver su saldo y descontarlo cuando el cliente lo use en tienda.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="OS-XXXX-XXXX-XXXX"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Buscar
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</div>
      )}
      {message && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{message}</div>
      )}

      {card && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-1 font-mono text-lg font-semibold">{card.code}</div>
          <div className="mb-4 text-sm text-gray-600">
            Saldo disponible: <strong>${card.balance.toLocaleString("es-CO")}</strong>{" "}
            {!card.isActive && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">Inactiva</span>}
          </div>

          {card.isActive && card.balance > 0 && (
            <div className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Monto a canjear"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleRedeem}
                disabled={loading}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Canjear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
