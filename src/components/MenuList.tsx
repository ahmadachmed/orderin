"use client";

import { MenuItemView } from "@/types";
import { formatRupiah } from "@/lib/format";

interface MenuListProps {
  items: MenuItemView[];
  quantities: Record<string, number>;
  onQuantityChange: (menuItemId: string, quantity: number) => void;
}

/**
 * MenuList — public shop menu (PLAN §8 / issue #4).
 * Presentational item rows with a quantity stepper. Cart state lives in
 * OrderForm, which owns `quantities` + `onQuantityChange`.
 */
export default function MenuList({ items, quantities, onQuantityChange }: MenuListProps) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-neutral-500">
        Menu belum tersedia — coba lagi nanti.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((item) => {
        const qty = quantities[item.id] ?? 0;
        return (
          <li key={item.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="truncate font-semibold text-neutral-900">{item.name}</h3>
                <span className="shrink-0 text-sm font-medium text-neutral-900">
                  {formatRupiah(item.price)}
                </span>
              </div>
              {item.description ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{item.description}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-neutral-400">
                ±{Math.round(item.prepTimeSeconds / 60)} menit
              </p>
            </div>

            {/* Quantity stepper */}
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-neutral-200 px-1 py-0.5">
              <button
                type="button"
                aria-label={`Kurangi ${item.name}`}
                disabled={qty === 0}
                onClick={() => onQuantityChange(item.id, qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-lg font-semibold text-neutral-600 disabled:text-neutral-300"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
              <button
                type="button"
                aria-label={`Tambah ${item.name}`}
                onClick={() => onQuantityChange(item.id, qty + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-lg font-semibold text-white active:scale-95"
              >
                +
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
