"use client";

// T28 ITEM 3 (issue #196) — Header "Buka Toko / Tutup Toko" segmented toggle.
// Shared admin layout header control, visible on every admin page.
// On mount fetchSettings() -> isOpen; click -> updateSettings({ isOpen: !isOpen })
// with optimistic state and inline error notice. No backend change — reuses
// the existing GET/PATCH /api/admin/settings contract (admin-api.ts).

import { useEffect, useRef, useState } from "react";
import { fetchSettings, updateSettings } from "@/lib/admin-api";
import type { TenantSettings } from "@/types/admin";

interface OpenToggleProps {
  /** Fired with the fresh settings after load and after each successful PATCH. */
  onLoaded?: (settings: TenantSettings) => void;
}

export default function OpenToggle({ onLoaded }: OpenToggleProps) {
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((settings) => {
        if (cancelled) return;
        setIsOpen(settings.isOpen);
        onLoadedRef.current?.(settings);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Gagal memuat status kedai",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(next: boolean) {
    if (isOpen === null || busy || next === isOpen) return;
    const prev = isOpen;
    setBusy(true);
    setError(null);
    setIsOpen(next); // optimistic
    try {
      const settings = await updateSettings({ isOpen: next });
      setIsOpen(settings.isOpen);
      onLoadedRef.current?.(settings);
    } catch (err) {
      setIsOpen(prev); // rollback on failure
      setError(
        err instanceof Error ? err.message : "Gagal mengubah status kedai",
      );
    } finally {
      setBusy(false);
    }
  }

  const segmentClass = (active: boolean) =>
    `px-4 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
    } disabled:cursor-not-allowed disabled:opacity-60`;

  return (
    <div className="flex items-center gap-3">
      <div
        role="group"
        aria-label="Status kedai"
        className="inline-flex overflow-hidden rounded-lg border border-border bg-secondary"
      >
        <button
          type="button"
          aria-pressed={isOpen === true}
          disabled={busy || isOpen === null}
          onClick={() => void handleToggle(true)}
          className={segmentClass(isOpen === true)}
        >
          Buka Toko
        </button>
        <button
          type="button"
          aria-pressed={isOpen === false}
          disabled={busy || isOpen === null}
          onClick={() => void handleToggle(false)}
          className={segmentClass(isOpen === false)}
        >
          Tutup Toko
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
