"use client";

/**
 * OrderLookupForm — T25 ITEM 1 (issue #164): manual order lookup entry point
 * on the shop page. "Lacak Pesanan" button opens an inline dialog with a
 * phone input; submitting calls POST /api/order/lookup and:
 *   200 → redirect to /[slug]/order/[orderId]
 *   404 → "Pesanan tidak ditemukan untuk nomor ini"
 *   429 → "Terlalu banyak percobaan, coba lagi nanti"
 * No backend changes — reuses the existing rate-limited API (5/min per IP).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Indonesian mobile number: optional +62/62 prefix, then 8 + 7-11 digits. */
const PHONE_RE = /^(?:\+62|62|0)8\d{7,11}$/;

export default function OrderLookupForm({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setError("Masukkan nomor HP dulu.");
      return;
    }
    if (!PHONE_RE.test(trimmed)) {
      setError("Nomor HP tidak valid — contoh: 081234567890");
      return;
    }
    setError(null);
    setLoading(true);
    fetch("/api/order/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: trimmed, slug: tenantSlug }),
    })
      .then(async (res) => {
        if (res.status === 200) {
          const data = (await res.json()) as { orderId?: string };
          if (data.orderId) {
            router.push(`/${tenantSlug}/order/${data.orderId}`);
            return;
          }
        }
        if (res.status === 404) {
          setError("Pesanan tidak ditemukan untuk nomor ini");
        } else if (res.status === 429) {
          setError("Terlalu banyak percobaan, coba lagi nanti");
        } else {
          setError("Terjadi kesalahan, coba lagi nanti.");
        }
      })
      .catch(() => setError("Terjadi kesalahan, coba lagi nanti."))
      .finally(() => setLoading(false));
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
        >
          <Search className="h-3.5 w-3.5" />
          Lacak Pesanan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Lacak Pesanan</DialogTitle>
          <DialogDescription>
            Masukkan nomor HP yang dipakai saat memesan untuk melihat status
            pesanan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="lookup-phone"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Nomor HP
            </label>
            <Input
              id="lookup-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="081234567890"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              className="h-11 rounded-lg border-border bg-background"
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-xl font-bold"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Mencari...
              </>
            ) : (
              "Lacak Pesanan"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
