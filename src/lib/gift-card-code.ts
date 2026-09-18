/**
 * Alfabeto sin caracteres ambiguos al leerlos en voz alta o escritos a mano:
 * sin 0/O, sin 1/I/L.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function randomGroup(length: number): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

/** Código legible tipo OS-XXXX-XXXX-XXXX para tarjetas de regalo. */
export function generateGiftCardCode(): string {
  return `OS-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`
}
