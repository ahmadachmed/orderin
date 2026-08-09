"use client";

// Customer register — /[tenantSlug]/register (P1P2 plan §3.5, Stitch
// mobile/register.html). POST /api/customer/register (T17-2): nama + phone +
// password → Customer created + HMAC session cookie (auto-login). On success
// the customer lands on their order history.

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { User, Phone, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function CustomerRegisterPage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Nama dan nomor HP wajib diisi.");
      return;
    }
    if (password.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi password tidak sama");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tenantSlug,
          name: name.trim(),
          phone: phone.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gagal mendaftar");
      router.push(`/${tenantSlug}/account/orders`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mendaftar");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-1rem)] items-center justify-center py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-extrabold tracking-tight">
            Buat Akun
          </CardTitle>
          <CardDescription>
            Dapatkan riwayat pesanan dan akses lintas perangkat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="name"
                required
              />
            </div>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Nomor HP (mis. 0812xxxx)"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="tel"
                required
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 6 karakter)"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Konfirmasi password"
                className="h-11 rounded-xl bg-background pl-9"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Mendaftarkan…" : "Daftar"}
            </Button>

            <p className="pt-1 text-center text-sm text-muted-foreground">
              Sudah punya akun?{" "}
              <Link
                href={`/${tenantSlug}/login`}
                className="font-medium text-primary hover:underline"
              >
                Masuk
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
