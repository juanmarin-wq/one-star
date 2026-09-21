"use client"

import { useState } from "react"
import Image from "next/image"
import { useCart } from "@/store"
import { formatCOP } from "@/lib/shop-utils"
import { validateCouponAction } from "@/server/actions/coupon.actions"
import { PLACEHOLDER_IMAGE_URL } from "@/lib/product-image"

export interface AppliedCoupon {
  code: string
  discountAmount: number
}

interface OrderSummaryProps {
  shippingCost: number
  appliedCoupon: AppliedCoupon | null
  onCouponChange: (coupon: AppliedCoupon | null) => void
}

export default function OrderSummary({ shippingCost, appliedCoupon, onCouponChange }: OrderSummaryProps) {
  const { items, subtotal } = useCart()
  const [isExpanded, setIsExpanded] = useState(false)
  const [couponCode, setCouponCode] = useState("")
  const [couponError, setCouponError] = useState("")
  const [couponApplying, setCouponApplying] = useState(false)

  const discount = appliedCoupon?.discountAmount ?? 0
  const total = subtotal - discount + shippingCost

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return
    setCouponApplying(true)
    setCouponError("")
    // El servidor valida vigencia, tope de usos, categoría y compra mínima, y
    // calcula el descuento. En placeOrder se revalida de nuevo: esto es solo
    // para la UI — por eso solo mandamos variantId+quantity, nunca precios.
    const result = await validateCouponAction(
      couponCode,
      items.map((i) => ({ variantId: i.id, quantity: i.quantity }))
    )
    if (result.valid && result.code && result.discountAmount !== undefined) {
      onCouponChange({ code: result.code, discountAmount: result.discountAmount })
      setCouponCode("")
    } else {
      setCouponError(result.error ?? "Cupón no válido")
    }
    setCouponApplying(false)
  }

  function handleRemoveCoupon() {
    onCouponChange(null)
    setCouponError("")
  }

  return (
    <div className="bg-[#F5F5F5] rounded-lg overflow-hidden">
      {/* Mobile toggle header */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#F0F0F0] border-b border-[#E0E0E0] md:hidden"
      >
        <span className="font-montserrat text-sm text-[#E31C23] font-medium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          {isExpanded ? "Ocultar resumen" : "Mostrar resumen del pedido"}
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
        <span className="font-barlow font-bold text-[#1C1C1C]">{formatCOP(total)}</span>
      </button>

      {/* Content — always visible on desktop, toggleable on mobile */}
      <div className={`${isExpanded ? "block" : "hidden"} md:block`}>
        {/* Items list */}
        <div className="p-4 space-y-4 border-b border-[#E0E0E0]">
          {items.length === 0 ? (
            <p className="text-[#4A4A4A] text-sm font-montserrat text-center py-4">
              Tu carrito está vacío
            </p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex gap-3">
                {/* Image with quantity badge */}
                <div className="relative flex-shrink-0">
                  <div className="w-14 h-14 rounded-md overflow-hidden bg-white border border-[#E0E0E0]">
                    <Image
                      src={item.imageUrl || PLACEHOLDER_IMAGE_URL}
                      alt={item.name}
                      width={56}
                      height={56}
                      className={`w-full h-full object-contain`}
                    />
                  </div>
                  <span className="absolute -top-2 -right-2 w-5 h-5 bg-[#4A4A4A] text-white text-xs rounded-full flex items-center justify-center font-montserrat font-medium">
                    {item.quantity}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-montserrat text-sm text-[#1C1C1C] font-medium leading-tight truncate">
                    {item.name}
                  </p>
                  <p className="font-montserrat text-xs text-[#4A4A4A] mt-0.5">
                    Talla {item.size} · {item.color}
                  </p>
                </div>

                {/* Price */}
                <span className="font-montserrat text-sm font-medium text-[#1C1C1C] flex-shrink-0">
                  {formatCOP(item.price * item.quantity)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Coupon field */}
        <div className="px-4 py-3 border-b border-[#E0E0E0]">
          {appliedCoupon ? (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-montserrat text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Cupón <strong>{appliedCoupon.code}</strong> aplicado
              </span>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                className="text-xs font-montserrat text-[#4A4A4A] underline hover:text-[#E31C23] transition-colors"
              >
                Quitar
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase())
                    setCouponError("")
                  }}
                  placeholder="Código de cupón"
                  className="flex-1 border border-[#E0E0E0] rounded px-3 py-2 text-sm font-montserrat text-[#1C1C1C] placeholder-[#4A4A4A] bg-white focus:outline-none focus:border-[#1C1C1C] transition-colors"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={couponApplying || !couponCode.trim()}
                  className="px-4 py-2 border border-[#1C1C1C] text-[#1C1C1C] text-sm font-montserrat font-medium rounded hover:bg-[#1C1C1C] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {couponApplying ? "..." : "Aplicar"}
                </button>
              </div>
              {couponError && (
                <p className="mt-1 text-xs text-[#E31C23] font-montserrat">{couponError}</p>
              )}
            </>
          )}
        </div>

        {/* Totals */}
        <div className="p-4 space-y-2">
          <div className="flex justify-between text-sm font-montserrat text-[#4A4A4A]">
            <span>Subtotal</span>
            <span>{formatCOP(subtotal)}</span>
          </div>
          {appliedCoupon && (
            <div className="flex justify-between text-sm font-montserrat text-green-700">
              <span>Descuento ({appliedCoupon.code})</span>
              <span>-{formatCOP(discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-montserrat text-[#4A4A4A]">
            <span>Envío</span>
            {shippingCost === 0 ? (
              <span className="text-green-600 font-medium">Gratis</span>
            ) : (
              <span>{formatCOP(shippingCost)}</span>
            )}
          </div>
          <div className="flex justify-between pt-3 border-t border-[#E0E0E0]">
            <span className="font-barlow font-bold text-[#1C1C1C] text-lg">Total</span>
            <span className="font-barlow font-bold text-[#1C1C1C] text-lg">{formatCOP(total)}</span>
          </div>
        </div>

        {/* Security badges */}
        <div className="px-4 pb-4 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#4A4A4A] font-montserrat">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Pago 100% seguro · SSL · ePayco · Mercadopago · Addi
          </div>
        </div>
      </div>
    </div>
  )
}
