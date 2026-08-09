"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  tenantSlug: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
}

export default function CreateAccountBanner({
  tenantSlug,
  customerName,
  customerPhone,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return null;

  const handleRegister = async () => {
    if (password.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    try {
      const res = await fetch("/api/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tenantSlug,
          name: customerName,
          phone: customerPhone,
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal mendaftar");
      setDone(true);
      window.location.reload(); // refresh to show logged-in state
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mendaftar");
    }
  };

  return (
    <Card className="p-4">
      {!showForm ? (
        <>
          <p className="text-sm font-medium text-foreground">
            🔒 Buat akun & simpan pesanan ini
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Dapatkan riwayat pesanan dan akses lintas perangkat.
          </p>
          <Button
            onClick={() => setShowForm(true)}
            className="mt-2"
            size="sm"
          >
            Buat Akun
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Buat akun</p>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              placeholder="Password (min 6 karakter)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleRegister} size="sm">
              Daftar
            </Button>
            <Button
              onClick={() => setShowForm(false)}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
