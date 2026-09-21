"use client"

import { useState, useRef, useEffect } from "react"
import { useCartStore } from "@/store"
import { sendChatMessageAction } from "@/server/actions/chat.actions"

interface DisplayMessage {
  role: "user" | "assistant"
  content: string
}

const WELCOME: DisplayMessage = {
  role: "assistant",
  content: "¡Hola! Soy el asistente de One Star. Pregúntame por cualquier producto — puedo revisar precio, tallas y stock, y agregarlo directo a tu carrito.",
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([WELCOME])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [hasCartActivity, setHasCartActivity] = useState(false)
  const addItem = useCartStore((s) => s.addItem)
  const openCart = useCartStore((s) => s.openCart)
  const isCartOpen = useCartStore((s) => s.isOpen)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  // El carrito (panel derecho, z-50) ocupa el mismo rincón que la burbuja del
  // chat (z-40) — se ocultan entre sí para no competir por el mismo espacio.
  if (isCartOpen) return null

  async function handleSend() {
    const text = input.trim()
    if (!text || sendingRef.current) return
    sendingRef.current = true
    setInput("")
    const nextMessages: DisplayMessage[] = [...messages, { role: "user", content: text }]
    setMessages(nextMessages)
    setLoading(true)

    const history = messages
      .filter((m) => m !== WELCOME)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const result = await sendChatMessageAction(history, text)

      if (result.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: result.error! }])
        return
      }

      if (result.actions.length > 0) setHasCartActivity(true)

      for (const action of result.actions) {
        if (action.type === "add_to_cart") {
          addItem({
            id: action.variantId,
            productId: action.productId,
            kind: "product",
            slug: action.slug,
            name: action.name,
            brand: action.brand,
            imageUrl: action.imageUrl,
            size: action.size,
            color: action.color,
            price: action.price,
            originalPrice: action.price,
            sku: action.sku,
            quantity: action.quantity,
          })
        }
      }

      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }])
    } catch (err) {
      console.error("[ChatWidget] sendChatMessageAction falló:", err)
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Tuve un problema para responder. Intenta de nuevo en un momento." },
      ])
    } finally {
      setLoading(false)
      sendingRef.current = false
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {open && (
        <div className="mb-3 flex h-[28rem] w-80 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:w-96">
          <div className="flex items-center justify-between bg-[#1C1C1C] px-4 py-3">
            <span className="font-montserrat text-sm font-semibold text-white">Asistente One Star</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white"
              aria-label="Cerrar chat"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-[#E31C23] text-white"
                      : "bg-gray-100 text-[#1C1C1C]"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-500">Escribiendo…</div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend()
                }}
                placeholder="Escribe tu pregunta..."
                className="flex-1 rounded-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E31C23]"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="rounded-full bg-[#E31C23] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
            {hasCartActivity && (
              <button
                type="button"
                onClick={openCart}
                className="mt-2 w-full rounded-full border border-gray-300 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Ver carrito
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E31C23] text-white shadow-lg transition-transform hover:scale-105"
        aria-label={open ? "Cerrar chat" : "Abrir chat de ventas"}
      >
        {open ? (
          <span className="text-xl">✕</span>
        ) : (
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-4 4v-4z" />
          </svg>
        )}
      </button>
    </div>
  )
}
