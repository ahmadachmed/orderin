"use client";
import { useState } from "react";

interface Props {
  tenantSlug: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
}

export default function CreateAccountBanner({ tenantSlug, customerName, customerPhone, orderId }: Props) {
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
    <div className="rounded-xl bg-blue-50 px-4 py-3">
      {!showForm ? (
        <>
          <p className="text-sm font-medium text-blue-800">
            🔒 Buat akun & simpan pesanan ini
          </p>
          <p className="mt-1 text-xs text-blue-600">
            Dapatkan riwayat pesanan dan akses lintas perangkat.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white"
          >
            Buat Akun
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-blue-800">Buat akun</p>
          <input
            type="password"
            placeholder="Password (min 6 karakter)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleRegister}
              className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
            >
              Daftar
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-blue-500"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
