"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { sendChatMessage, type ChatMessage, type CartAction } from "@/server/services/ai-chat.service"

/** Rate limiting en memoria por IP (se reinicia al reiniciar el proceso). */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_MESSAGES = 20

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const record = attempts.get(ip)
  if (record && now < record.resetAt) {
    if (record.count >= MAX_MESSAGES) return true
    record.count++
    return false
  }
  attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  return false
}

const inputSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      })
    )
    .max(20),
})

export interface SendChatMessageResult {
  reply: string
  actions: CartAction[]
  error?: string
}

export async function sendChatMessageAction(
  history: ChatMessage[],
  message: string
): Promise<SendChatMessageResult> {
  const parsed = inputSchema.safeParse({ message, history })
  if (!parsed.success) {
    return { reply: "", actions: [], error: "Mensaje no válido." }
  }

  const headerList = await headers()
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return { reply: "", actions: [], error: "Muchos mensajes seguidos. Espera un minuto." }
  }

  const result = await sendChatMessage(parsed.data.history, parsed.data.message)
  return { reply: result.reply, actions: result.actions }
}
