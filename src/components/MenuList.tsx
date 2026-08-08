"use client";

import { MenuItemView } from "@/types";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface MenuListProps {
  items: MenuItemView[];
  quantities: Record<string, number>;
  onQuantityChange: (menuItemId: string, quantity: number) => void;
}

/**
 * MenuList — public shop menu (PLAN §2.3 / issue #104).
 * Card item rows with a quantity stepper. Cart state lives in
 * OrderForm, which owns `quantities` + `onQuantityChange`.
 */
export default function MenuList({ items, quantities, onQuantityChange }: MenuListProps) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Menu belum tersedia — coba lagi nanti.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const qty = quantities[item.id] ?? 0;
        return (
          <li key={item.id}>
            <Card className="flex gap-4 border-border bg-card p-4">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-semibold text-foreground">{item.name}</h3>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-primary">
                    {formatRupiah(item.price)}
                  </span>
                </div>
                {item.description ? (
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  ±{Math.round(item.prepTimeSeconds / 60)} menit
                </p>
              </div>

              {qty === 0 ? (
                <Button
                  type="button"
                  aria-label={`Tambah ${item.name}`}
                  onClick={() => onQuantityChange(item.id, qty + 1)}
                  className="h-8 w-8 shrink-0 rounded-full bg-primary p-0 text-primary-foreground"
                >
                  +
                </Button>
              ) : (
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted p-1">
                  <Button
                    type="button"
                    aria-label={`Kurangi ${item.name}`}
                    disabled={qty === 0}
                    onClick={() => onQuantityChange(item.id, qty - 1)}
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-lg font-semibold text-muted-foreground hover:text-foreground"
                  >
                    −
                  </Button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <Button
                    type="button"
                    aria-label={`Tambah ${item.name}`}
                    onClick={() => onQuantityChange(item.id, qty + 1)}
                    className="h-7 w-7 rounded-full bg-primary p-0 text-lg font-semibold text-primary-foreground"
                  >
                    +
                  </Button>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
