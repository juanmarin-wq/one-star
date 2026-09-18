"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef, useTransition } from "react"
import { type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "./DataTable"
import { bulkToggleProductsPublishStatus } from "@/app/admin/productos/actions"
import type { ProductDTO } from "@/server/services/product.service"
import { PLACEHOLDER_IMAGE_URL } from "@/lib/product-image"
import { useToast } from "@/hooks/useToast"
import ToastContainer from "@/components/ui/ToastContainer"
import {
  createSingleFlightRunner,
  getAdminProductStatus,
  getBulkPublishFeedback,
  getProductRowId,
} from "./product-table.model"

const columns: ColumnDef<ProductDTO, unknown>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        className="w-4 h-4 rounded border-gray-300 text-[#E31C23] focus:ring-[#E31C23] cursor-pointer"
        aria-label="Seleccionar todos"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="w-4 h-4 rounded border-gray-300 text-[#E31C23] focus:ring-[#E31C23] cursor-pointer"
        aria-label="Seleccionar fila"
      />
    ),
    enableSorting: false,
    meta: { width: "40px", align: "center" },
  },
  {
    id: "foto",
    header: "Foto",
    enableSorting: false,
    meta: { width: "64px" },
    cell: ({ row }) => {
      const img = row.original.images[0]
      return (
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
          <Image
            src={img?.url ?? PLACEHOLDER_IMAGE_URL}
            alt={img?.alt ?? `${row.original.name} — sin foto`}
            width={48}
            height={48}
            className={`w-full h-full object-contain`}
          />
        </div>
      )
    },
  },
  {
    id: "nombre",
    header: "Nombre",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <span className="font-medium text-[#1C1C1C]">{row.original.name}</span>
        <br />
        <span className="text-xs text-[#4A4A4A]">{row.original.slug}</span>
      </div>
    ),
  },
  {
    id: "marca",
    header: "Marca",
    accessorKey: "brandName",
    cell: ({ row }) => (
      <span className="text-[#4A4A4A]">{row.original.brandName ?? "—"}</span>
    ),
  },
  {
    id: "categoria",
    header: "Categoría web",
    accessorFn: (row) => row.category.name,
    cell: ({ row }) => (
      <span className="text-[#4A4A4A]">{row.original.category.name}</span>
    ),
  },
  {
    id: "origen",
    header: "Origen",
    accessorFn: (row) => (row.erpId ? "ERP" : "Manual"),
    cell: ({ row }) => {
      const isErp = Boolean(row.original.erpId)
      return (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isErp ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-700"
          }`}
          title={isErp ? `Sincronizado desde el ERP (erpId: ${row.original.erpId})` : "Cargado manualmente (admin o Excel)"}
        >
          {isErp ? "ERP" : "Manual"}
        </span>
      )
    },
  },
  {
    id: "precio",
    header: "Precio",
    accessorKey: "basePrice",
    cell: ({ row }) => {
      const { basePrice, isOnSale, salePrice } = row.original
      return isOnSale && salePrice ? (
        <div>
          <span className="text-[#E31C23] font-semibold">
            ${salePrice.toLocaleString("es-CO")}
          </span>
          <span className="text-xs line-through text-gray-400 ml-1">
            ${basePrice.toLocaleString("es-CO")}
          </span>
        </div>
      ) : (
        <span className="font-semibold text-[#1C1C1C]">
          ${basePrice.toLocaleString("es-CO")}
        </span>
      )
    },
  },
  {
    id: "stock",
    header: "Stock",
    accessorFn: (row) => row.variants.reduce((s, v) => s + v.stock, 0),
    cell: ({ row }) => {
      const total = row.original.variants.reduce((s, v) => s + v.stock, 0)
      return (
        <span className={`font-medium ${total === 0 ? "text-red-500" : "text-[#1C1C1C]"}`}>
          {total}
        </span>
      )
    },
  },
  {
    id: "estado",
    header: "Estado",
    accessorFn: (row) => {
      const { label } = getAdminProductStatus(row)
      return label
    },
    cell: ({ row }) => {
      const status = getAdminProductStatus(row.original)
      return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
          {status.label}
        </span>
      )
    },
  },
  {
    id: "acciones",
    header: "Acciones",
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/admin/productos/${row.original.id}`}
          className="text-xs font-medium text-[#E31C23] hover:underline"
        >
          Editar
        </Link>
        <span className="text-gray-300">|</span>
        <Link
          href={`/productos/${row.original.slug}`}
          target="_blank"
          className="text-xs font-medium text-[#4A4A4A] hover:underline"
        >
          Ver en tienda
        </Link>
      </div>
    ),
  },
]

interface ProductosTableProps {
  products: ProductDTO[]
  total: number
  page: number
  totalPages: number
  prevHref?: string
  nextHref?: string
  emptyMessage?: string
}

export function ProductosTable({
  products,
  total,
  page,
  totalPages,
  prevHref,
  nextHref,
  emptyMessage = "Aún no hay productos.",
}: ProductosTableProps) {
  const [isPending, startTransition] = useTransition()
  const updateRunner = useRef(createSingleFlightRunner())
  const { toasts, showToast, dismissToast } = useToast()

  function updatePublishStatus(
    selectedRows: ProductDTO[],
    isPublished: boolean,
    clearSelection: () => void
  ) {
    startTransition(async () => {
      await updateRunner.current.run(async () => {
        try {
          const result = await bulkToggleProductsPublishStatus(
            selectedRows.map((row) => row.id),
            isPublished
          )
          const feedback = getBulkPublishFeedback(result, isPublished)
          showToast(feedback.message, feedback.type)
          if (feedback.clearSelection) clearSelection()
        } catch {
          showToast("No se pudieron actualizar los productos.", "error")
        }
      })
    })
  }

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-[#4A4A4A] text-lg mb-4">{emptyMessage}</p>
          <Link
            href="/admin/integraciones"
            className="inline-block bg-[#E31C23] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Sincronizar desde Loggro
          </Link>
        </div>
      ) : (
        <DataTable
          key={`${page}:${products.map((product) => product.id).join(":")}`}
          data={products}
          columns={columns}
          getRowId={getProductRowId}
          pagination={{ page, totalPages, totalCount: total, unit: "productos", prevHref, nextHref }}
          emptyMessage={emptyMessage}
          toolbar={(selectedRows, clearSelection) => (
            <div className="flex items-center gap-4 bg-[#F9FAFB] border border-gray-200 p-3 rounded-xl">
              <span className="text-sm font-semibold text-[#1C1C1C]">
                {selectedRows.length} producto{selectedRows.length !== 1 && "s"} seleccionado{selectedRows.length !== 1 && "s"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updatePublishStatus(selectedRows, true, clearSelection)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 rounded-lg text-[#1C1C1C] hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {isPending ? "Procesando..." : "Activar"}
                </button>
                <button
                  type="button"
                  onClick={() => updatePublishStatus(selectedRows, false, clearSelection)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#E31C23] border border-[#E31C23] rounded-lg text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isPending ? "Procesando..." : "Desactivar"}
                </button>
              </div>
            </div>
          )}
        />
      )}
    </>
  )
}
