"use client";

// Sprint detail (T15, PLAN §4.6): one sprint — header (tanggal, status,
// durasi, carry-over), ringkasan (total order, omzet Σ PAID, cancel count,
// carry-over), then the full order list grouped by status, readonly.
// OPEN sprints get a "Tutup Sprint" button (POST .../close, carry-over).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  closeSprint,
  fetchSprintDetail,
  type SprintDetail as SprintDetailData,
  type SprintDetailOrder,
} from "@/lib/admin-api";
import type { OrderStatus } from "@/types/admin";
import { formatDuration, formatPrice } from "@/types/admin";
import AdminStatusBadge from "./AdminStatusBadge";
import PaymentBadge from "./PaymentBadge";

const GROUP_ORDER: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "BREWING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "CANCELLED",
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Durasi sprint: endAt−startAt saat CLOSED, now−startAt saat masih OPEN. */
function sprintDurationMs(
  startAt: string,
  endAt: string | null,
): number {
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  return Math.max(0, end - new Date(startAt).getTime());
}

/** Format ms → "2j 15m" / "45m" / "30d 4j". */
function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}h`);
  if (h > 0 || d > 0) parts.push(`${h}j`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

// Readonly order card — same look as the dashboard OrderCard (PLAN §4.6:
// "seperti di dashboard, tapi readonly (no drag)").
function ReadonlyOrderCard({ order }: { order: SprintDetailOrder }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">
            {order.customerName}
          </p>
          <p className="text-xs text-muted-foreground">{order.customerPhone}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AdminStatusBadge status={order.status} />
          <PaymentBadge paymentStatus={order.paymentStatus} />
        </div>
      </div>

      <ul className="mt-2 space-y-0.5 text-sm text-foreground">
        {(order.items ?? []).map((it) => (
          <li key={it.id} className="flex justify-between gap-2">
            <span className="truncate">
              {it.quantity}× {it.name ?? "Item"}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatPrice(
                (typeof it.unitPrice === "string" ? parseFloat(it.unitPrice) : it.unitPrice) *
                  it.quantity,
              )}
            </span>
          </li>
        ))}
        {!order.items?.length && (
          <li className="italic text-muted-foreground">No items</li>
        )}
      </ul>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="tabular-nums">Total {formatPrice(order.total)}</span>
        {order.etaSeconds != null && (
          <span className="text-muted-foreground">ETA {formatDuration(order.etaSeconds)}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export default function SprintDetail({ sprintId }: { sprintId: string }) {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params.tenantSlug;

  const [data, setData] = useState<SprintDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchSprintDetail(sprintId));
      setAuthError(false);
      setError(null);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else setError(err instanceof Error ? err.message : "Failed to load sprint");
    } finally {
      setLoaded(true);
    }
  }, [sprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  // LOGIN-05: expired session → login page.
  useEffect(() => {
    if (authError && tenantSlug) router.push(`/admin/${tenantSlug}/login`);
  }, [authError, tenantSlug, router]);

  const groups = useMemo(() => {
    if (!data) return [];
    return GROUP_ORDER.map((status) => ({
      status,
      orders: data.orders.filter((o) => o.status === status),
    }));
  }, [data]);

  async function handleClose() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await closeSprint(data.sprint.id);
      setNotice(
        `Sprint ditutup — ${res.carriedOver} order dibawa ke sprint baru, ${res.archived} diarsipkan.`,
      );
      await load();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setAuthError(true);
      else if (status === 409) {
        // Race: someone else closed it first — refresh to show the truth.
        setNotice("Sprint sudah ditutup oleh operasi lain.");
        await load();
      } else {
        setError(err instanceof Error ? err.message : "Gagal menutup sprint");
      }
    } finally {
      setBusy(false);
    }
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">
        Session expired — redirecting to login…
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="py-6 text-center text-sm text-muted-foreground">Memuat sprint…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error ?? "Sprint tidak ditemukan"}
        </p>
        <a
          href={`/admin/${tenantSlug}/sprints`}
          className="mt-3 inline-block rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          ← Kembali ke riwayat
        </a>
      </div>
    );
  }

  const { sprint } = data;
  const isOpen = sprint.status === "OPEN";
  const durationMs = sprintDurationMs(sprint.startAt, sprint.endAt);
  const carriedOver = data.orders.filter(
    (o) => new Date(o.createdAt).getTime() < new Date(sprint.startAt).getTime(),
  ).length;
  const cancelCount = data.orders.filter((o) => o.status === "CANCELLED").length;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error} — retrying…
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          ✓ {notice}
        </p>
      )}

      {/* Header: tanggal, status, durasi, carry-over (PLAN §4.6) */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Sprint · {fmtDate(sprint.startAt)}
          </p>
          <h2 className="mt-1 text-lg font-bold text-foreground">
            {isOpen ? "Sprint berjalan" : "Sprint ditutup"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Durasi {fmtDuration(durationMs)}
            {sprint.endAt ? ` · tutup ${fmtDate(sprint.endAt)}` : " · masih berjalan"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
              isOpen
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/50"
                : "bg-secondary text-muted-foreground border-border"
            }`}
          >
            {isOpen ? "OPEN" : "CLOSED"}
          </span>
          {isOpen && (
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={busy}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Menutup…" : "Tutup Sprint"}
            </button>
          )}
        </div>
      </div>

      {/* Ringkasan: total order, omzet, cancel, carry-over (PLAN §4.6) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total order" value={String(sprint.orderCount)} />
        <Stat label="Omzet (PAID)" value={formatPrice(sprint.revenue)} />
        <Stat label="Cancel" value={String(cancelCount)} />
        <Stat label="Carry-over" value={String(carriedOver)} />
      </div>

      {/* List order grouped by status (PLAN §4.6) */}
      {groups.map(
        ({ status, orders }) =>
          orders.length > 0 && (
            <div
              key={status}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <AdminStatusBadge status={status} />
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {orders.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {orders.map((o) => (
                  <ReadonlyOrderCard key={o.id} order={o} />
                ))}
              </div>
            </div>
          ),
      )}

      {data.orders.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
          Belum ada order di sprint ini.
        </p>
      )}
    </div>
  );
}

