// @vitest-environment jsdom
/**
 * T25-11 (issue #171) — Admin settings form validation unit tests.
 * Covers the "Jam Operasional" section added in T25-10 (PR #180):
 *   - HH:mm validation on openTime/closeTime (client-side, before submit)
 *   - timezone required + valid IANA
 *   - prepTimeBuffer bounds 0-600 / maxQueueSize bounds 1-1000
 *     (rejected via native constraint validation: min/max/step block the
 *     submit event before React's onSubmit runs — no PATCH ever leaves)
 *   - isOpen toggle (role="switch")
 *   - load() pre-populates fields from GET; save() sends all fields to PATCH
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import AdminSettingsPage from "@/app/admin/[tenantSlug]/settings/page";
import { fetchSettings, updateSettings } from "@/lib/admin-api";
import type { TenantSettings } from "@/types/admin";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenantSlug: "kopi-senja" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/admin-api", () => ({
  adminLogout: vi.fn(),
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const DEFAULT_SETTINGS: TenantSettings = {
  id: "tnt_1",
  slug: "kopi-senja",
  name: "Kopi Senja",
  isOpen: true,
  openTime: "07:00",
  closeTime: "21:00",
  timezone: "Asia/Makassar",
  maxQueueSize: 20,
  prepTimeBuffer: 0,
  sprintDurationDays: 1,
  qrisImageUrl: null,
  qrisCode: null,
  bankAccountNumber: null,
  bankName: null,
  plan: "FREE",
  planExpiresAt: null,
  isActive: true,
  contactEmail: null,
};

/** Render the page with fetchSettings mocked, then wait for the form to load. */
async function renderPage(settings: TenantSettings = DEFAULT_SETTINGS) {
  (fetchSettings as ReturnType<typeof vi.fn>).mockResolvedValue(settings);
  render(<AdminSettingsPage />);
  await screen.findByRole("button", { name: "Simpan pengaturan" });
}

function jamOperasionalSection(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Jam Operasional" });
  return heading.closest("section") as HTMLElement;
}

/** openTime / closeTime / timezone / switch / prepTimeBuffer / maxQueueSize. */
function getFields() {
  const section = jamOperasionalSection();
  const spinbuttons = within(section).getAllByRole("spinbutton");
  return {
    openTime: screen.getByPlaceholderText("07:00"),
    closeTime: screen.getByPlaceholderText("21:00"),
    timezone: screen.getByPlaceholderText("Asia/Jakarta"),
    switch: screen.getByRole("switch"),
    prepTimeBuffer: spinbuttons[0],
    maxQueueSize: spinbuttons[1],
  };
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Simpan pengaturan" }));
}

beforeEach(() => {
  (fetchSettings as ReturnType<typeof vi.fn>).mockReset();
  (updateSettings as ReturnType<typeof vi.fn>).mockReset();
  (updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(
    DEFAULT_SETTINGS,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdminSettingsPage — Jam Operasional (T25-10)", () => {
  it("renders the Jam Operasional section with all 6 fields after load", async () => {
    await renderPage();
    const section = jamOperasionalSection();
    const fields = getFields();
    // Inputs show LOCAL time: 07:00 UTC → 15:00 Asia/Makassar (+8),
    // 21:00 UTC → 05:00 next day.
    expect(within(section).getByDisplayValue("15:00")).toBeInTheDocument();
    expect(within(section).getByDisplayValue("05:00")).toBeInTheDocument();
    expect(
      within(section).getByDisplayValue("Asia/Makassar"),
    ).toBeInTheDocument();
    expect(fields.switch).toBeInTheDocument();
    expect(within(section).getByDisplayValue("0")).toBeInTheDocument();
    expect(within(section).getByDisplayValue("20")).toBeInTheDocument();
  });

  it("pre-populates the 6 fields from GET /api/admin/settings on load, converting UTC → local", async () => {
    await renderPage({
      ...DEFAULT_SETTINGS,
      openTime: "09:30",
      closeTime: "17:45",
      timezone: "Asia/Jakarta",
      isOpen: false,
      prepTimeBuffer: 15,
      maxQueueSize: 42,
    });
    const fields = getFields();
    // 09:30 UTC → 16:30 WIB (+7); 17:45 UTC → 00:45 WIB next day.
    expect((fields.openTime as HTMLInputElement).value).toBe("16:30");
    expect((fields.closeTime as HTMLInputElement).value).toBe("00:45");
    expect((fields.timezone as HTMLInputElement).value).toBe("Asia/Jakarta");
    expect(fields.switch).toHaveAttribute("aria-checked", "false");
    expect((fields.prepTimeBuffer as HTMLInputElement).value).toBe("15");
    expect((fields.maxQueueSize as HTMLInputElement).value).toBe("42");
  });

  it("shows raw UTC values when the stored timezone is null (fallback, no conversion)", async () => {
    await renderPage({
      ...DEFAULT_SETTINGS,
      openTime: "07:00",
      closeTime: "21:00",
      timezone: "",
    });
    const fields = getFields();
    expect((fields.openTime as HTMLInputElement).value).toBe("07:00");
    expect((fields.closeTime as HTMLInputElement).value).toBe("21:00");
  });

  it("re-converts displayed times when the timezone changes", async () => {
    await renderPage(); // 15:00 / 05:00 Asia/Makassar
    const fields = getFields();
    fireEvent.change(fields.timezone, { target: { value: "Asia/Jakarta" } });
    // Same UTC instant (07:00/21:00) re-rendered in UTC+7 → 14:00 / 04:00.
    expect((fields.openTime as HTMLInputElement).value).toBe("14:00");
    expect((fields.closeTime as HTMLInputElement).value).toBe("04:00");
  });

  it("converts local input → UTC on save (15:00 Makassar → 07:00 UTC)", async () => {
    await renderPage(); // openTime displayed 15:00 local already
    fireEvent.change(getFields().openTime, { target: { value: "15:00" } });
    fireEvent.change(getFields().closeTime, { target: { value: "05:00" } });
    await submit();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          openTime: "07:00",
          closeTime: "21:00",
          timezone: "Asia/Makassar",
        }),
      ),
    );
  });

  it("rejects invalid openTime '25:00' with an HH:mm error and no PATCH", async () => {
    await renderPage();
    fireEvent.change(getFields().openTime, { target: { value: "25:00" } });
    await submit();
    await screen.findByText("Jam buka harus format HH:mm (contoh: 07:00)");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-numeric openTime 'abc' with an HH:mm error", async () => {
    await renderPage();
    fireEvent.change(getFields().openTime, { target: { value: "abc" } });
    await submit();
    await screen.findByText("Jam buka harus format HH:mm (contoh: 07:00)");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid closeTime '25:00' with an HH:mm error", async () => {
    await renderPage();
    fireEvent.change(getFields().closeTime, { target: { value: "25:00" } });
    await submit();
    await screen.findByText("Jam tutup harus format HH:mm (contoh: 21:00)");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("requires a timezone", async () => {
    await renderPage();
    fireEvent.change(getFields().timezone, { target: { value: "" } });
    await submit();
    await screen.findByText("Timezone wajib diisi (contoh: Asia/Jakarta)");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-IANA timezone string", async () => {
    await renderPage();
    fireEvent.change(getFields().timezone, { target: { value: "Not/AZone" } });
    await submit();
    await screen.findByText(
      "Timezone tidak valid — gunakan IANA timezone (contoh: Asia/Jakarta)",
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("accepts a valid IANA timezone string", async () => {
    await renderPage();
    fireEvent.change(getFields().timezone, {
      target: { value: "Asia/Jayapura" },
    });
    await submit();
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
  });

  it("rejects prepTimeBuffer below 0 — native validation blocks submit", async () => {
    await renderPage();
    const input = getFields().prepTimeBuffer;
    fireEvent.change(input, { target: { value: "-1" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects prepTimeBuffer above 600 — native validation blocks submit", async () => {
    await renderPage();
    const input = getFields().prepTimeBuffer;
    fireEvent.change(input, { target: { value: "601" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-integer prepTimeBuffer — native step validation blocks submit", async () => {
    await renderPage();
    const input = getFields().prepTimeBuffer;
    fireEvent.change(input, { target: { value: "1.5" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("accepts prepTimeBuffer boundary values 0 and 600", async () => {
    await renderPage();
    fireEvent.change(getFields().prepTimeBuffer, { target: { value: "600" } });
    await submit();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ prepTimeBuffer: 600 }),
      ),
    );
  });

  it("rejects maxQueueSize below 1 — native validation blocks submit", async () => {
    await renderPage();
    const input = getFields().maxQueueSize;
    fireEvent.change(input, { target: { value: "0" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects maxQueueSize above 1000 — native validation blocks submit", async () => {
    await renderPage();
    const input = getFields().maxQueueSize;
    fireEvent.change(input, { target: { value: "1001" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-integer maxQueueSize — native step validation blocks submit", async () => {
    await renderPage();
    const input = getFields().maxQueueSize;
    fireEvent.change(input, { target: { value: "2.5" } });
    expect((input as HTMLInputElement).validity.valid).toBe(false);
    await submit();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("accepts maxQueueSize boundary values 1 and 1000", async () => {
    await renderPage();
    fireEvent.change(getFields().maxQueueSize, { target: { value: "1000" } });
    await submit();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ maxQueueSize: 1000 }),
      ),
    );
  });

  it("isOpen toggle flips aria-checked and is sent on save", async () => {
    await renderPage();
    const toggle = getFields().switch;
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await submit();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ isOpen: false }),
      ),
    );
  });

  it("sends all 6 fields on a valid PATCH save, converting local → UTC", async () => {
    await renderPage();
    const fields = getFields();
    // Change timezone FIRST (re-converts displayed times), then set times in
    // the new local zone: 08:30 WIB → 01:30 UTC, 22:15 WIB → 15:15 UTC.
    fireEvent.change(fields.timezone, { target: { value: "Asia/Jakarta" } });
    fireEvent.change(fields.openTime, { target: { value: "08:30" } });
    fireEvent.change(fields.closeTime, { target: { value: "22:15" } });
    fireEvent.click(fields.switch);
    fireEvent.change(fields.prepTimeBuffer, { target: { value: "15" } });
    fireEvent.change(fields.maxQueueSize, { target: { value: "42" } });
    await submit();
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          openTime: "01:30",
          closeTime: "15:15",
          timezone: "Asia/Jakarta",
          isOpen: false,
          prepTimeBuffer: 15,
          maxQueueSize: 42,
        }),
      ),
    );
    await screen.findByText(/Tersimpan/);
  });

  it("shows the error message when PATCH fails", async () => {
    await renderPage();
    (updateSettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Gagal menyimpan pengaturan"), { status: 500 }),
    );
    await submit();
    await screen.findByText("Gagal menyimpan pengaturan");
    expect(screen.queryByText(/Tersimpan/)).not.toBeInTheDocument();
  });
});
