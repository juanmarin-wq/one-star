"use client"

import { useState } from "react"
import Link from "next/link"
import {
  previewProductImportAction,
  applyProductImportAction,
} from "./actions"
import type { ProductImportPreview, ProductImportApplyResult } from "@/server/services/product-import.service"

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  create_product: { label: "Crear producto", className: "bg-green-50 text-green-800" },
  add_variant: { label: "Agregar variante", className: "bg-blue-50 text-blue-800" },
  update_variant: { label: "Actualizar variante", className: "bg-amber-50 text-amber-800" },
  error: { label: "Error", className: "bg-red-50 text-red-800" },
}

export default function ImportarProductosPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ProductImportPreview | null>(null)
  const [result, setResult] = useState<ProductImportApplyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreview() {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    const formData = new FormData()
    formData.set("file", file)
    const res = await previewProductImportAction(formData)
    setLoading(false)
    if (!res.success || !res.data) {
      setError(res.error ?? "No se pudo generar la vista previa.")
      setPreview(null)
      return
    }
    setPreview(res.data)
  }

  async function handleConfirm() {
    if (!file || !preview) return
    setLoading(true)
    setError(null)
    const formData = new FormData()
    formData.set("file", file)
    formData.set("fingerprint", preview.fingerprint)
    const res = await applyProductImportAction(formData)
    setLoading(false)
    if (!res.success || !res.data) {
      setError(res.error ?? "No se pudo confirmar la importación.")
      return
    }
    setResult(res.data)
    setPreview(null)
    setFile(null)
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Importar productos desde Excel</h1>
        <Link href="/admin/productos" className="text-sm text-gray-600 hover:underline">
          Volver a productos
        </Link>
      </div>

      <p className="mb-6 max-w-3xl text-sm text-gray-600">
        Sube el archivo con la plantilla de carga de productos. Primero se genera una vista previa
        (no se guarda nada todavía); revísala y confirma para escribir los cambios. Los productos
        que ya gestiona el ERP nunca se modifican desde aquí.
      </p>

      {result && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Importación completada: {result.newProducts} producto(s) nuevo(s), {result.newVariants}{" "}
          variante(s) nueva(s), {result.updatedVariants} variante(s) actualizada(s).
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      {!preview && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700"
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || loading}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Generar vista previa"}
          </button>
        </div>
      )}

      {preview && (
        <div>
          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-green-100 px-3 py-1 text-green-800">
              {preview.summary.newProducts} producto(s) nuevo(s)
            </span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">
              {preview.summary.newVariants} variante(s) nueva(s)
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
              {preview.summary.updatedVariants} variante(s) a actualizar
            </span>
            <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">
              {preview.summary.errors} error(es)
            </span>
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                    <td className="px-3 py-2">{r.productName}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${ACTION_LABELS[r.action].className}`}>
                        {ACTION_LABELS[r.action].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading || preview.summary.newProducts + preview.summary.newVariants + preview.summary.updatedVariants === 0}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Guardando..." : "Confirmar importación"}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancelar / subir otro archivo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
