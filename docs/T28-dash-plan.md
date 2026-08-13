# T28: Admin Dashboard — Align Stitch Concept (Layout + Copywriting) — PLAN

Repo: `~/Documents/bukan_project/orderin` | HEAD: `1a53b89` (origin/main; T26/T27 merged — task body said `27123f8`, that commit IS an ancestor, only docs commits `1f09587`+`1a53b89` added since) | Issue: #193

Scope: **layout + copywriting ONLY** — align admin dashboard with Stitch design concept (`~/Documents/orderin-stitch-design/desktop/dashboard.html`). No schema/API change except reuse of `PATCH /api/admin/settings` `isOpen`.

---

## 0. CLAIM VERIFICATION (task body vs repo ground truth)

Verified every claim in the task body against `origin/main`. **4 discrepancies found:**

| # | Task body claim | Repo reality | Impact |
|---|---|---|---|
| V1 | "layout di `src/app/admin/[tenantSlug]/layout.tsx`" | **NO such file.** No `layout.tsx` anywhere under `src/app/admin/`. Only `src/app/layout.tsx` (root). | Sidebar rail requires CREATING a shared layout — the top-pill nav is copy-pasted into **4 pages** (`page.tsx`, `menu/page.tsx`, `settings/page.tsx`, `sprints/page.tsx`) + `sprints/[sprintId]/page.tsx` (partial, back-link). |
| V2 | "OrderCard di `src/components/admin/`" | OrderCard is at **`src/components/OrderCard.tsx`** (imported as `../OrderCard` by `StatusColumn.tsx:7`). `src/components/admin/` has: AdminStatusBadge, PaymentBadge, SprintDetail, SprintList, StatusColumn. | Minor — file paths in this plan reflect the real location. |
| V3 | "T25-1 sudah translate STATUS_LABELS ke Indonesian" | **PENDING is still `"Pending"` (English).** `types/admin.ts:95` + `AdminStatusBadge.tsx:15`. `tests/admin-types.test.ts:32` asserts it and comments `// unchanged per plan table`. | The admin PENDING badge is English while the customer status page shows "Menunggu konfirmasi" and the Stitch design shows "Menunggu konfirmasi" (dashboard.html:178). Inconsistency — see OPEN DECISION D3. |
| V4 | Stitch design nav = 4 items (Dashboard/Menu/Pengaturan/Logout) | Current admin nav = **6 items**: Menu, Riwayat (sprints), Pembayaran (settings), Lihat Toko ↗, Keluar (+ implicit Dasbor). Sprints (`Riwayat`) is a **real merged feature** (T15 — API + pages + e2e). | Sidebar with only 4 items makes sprints UNREACHABLE. See OPEN DECISION D1 (blocking). |

Other claims **verified correct**:
- `PATCH /api/admin/settings` `isOpen` boolean handler at `route.ts:79-82` ✓ (STRING_FIELDS + isOpen + HH:mm validation) — reusable for toggle.
- `fetchSettings()` / `updateSettings()` already exist in `src/lib/admin-api.ts:136-147` ✓ — no new API client needed.
- Settings page already has a working `isOpen` switch ("Status kedai", `settings/page.tsx:364-386`) using the same PATCH — proof the toggle pattern works.
- `STATUS_FLOW` = PENDING→CONFIRMED→BREWING→READY_FOR_PICKUP→PICKED_UP, CANCELLED as card action ✓ (`types/admin.ts:86-92`).
- Tip bar exists (`page.tsx:281-283`) but uses emoji 🔒 (CLAUDE.md forbids emojis) and stale copy.
- PIN modal copy mostly matches concept already (`page.tsx:286-333`), except body leaks raw enum `"PICKED_UP"` (`page.tsx:293-294`).

---

## 1. SCOPE ITEMS

### ITEM 1 — Sidebar rail (replace top pills header)  [foundation]

**Konteks**: Current nav is top-pill links duplicated per-page (`page.tsx:213-247`, `menu/page.tsx:164-184`, `settings/page.tsx:194-214`, `sprints/page.tsx:51-91`, `sprints/[sprintId]/page.tsx:29-61`). Stitch concept = fixed left rail (dashboard.html:93-126): logo + "Admin Console", then Dashboard / Menu / Pengaturan (Indonesian), Logout at bottom in error color.

**Approach**: Create a shared admin layout + Sidebar component; delete per-page nav. Rail items (Indonesian per T25-3): **Dasbor / Menu / Pengaturan / Keluar**. Logo slot uses existing tenant logo/name (or "Orderin / Admin Console" placeholder — logo asset is NOT in scope, use text-only brand). Keluar = logout button (red), reuses existing `adminLogout()` + redirect to `/`.

**Files changed**:
1. `src/app/admin/[tenantSlug]/layout.tsx` — **NEW** client component; renders `<Sidebar tenantSlug={...} />` + `<main>` wrapper; holds the shared top header (shop name + Buka/Tutup toggle — see ITEM 3).
2. `src/components/admin/Sidebar.tsx` — **NEW**; rail with 4 items + logout.
3. `src/app/admin/[tenantSlug]/page.tsx` — remove nav block (lines 213-247); keep page title/subtitle (ITEM 2).
4. `src/app/admin/[tenantSlug]/menu/page.tsx` — remove nav (164-184).
5. `src/app/admin/[tenantSlug]/settings/page.tsx` — remove nav (194-214).
6. `src/app/admin/[tenantSlug]/sprints/page.tsx` — remove nav (51-91); keep "+ Buka Sprint Baru" action somewhere in page body.
7. `src/app/admin/[tenantSlug]/sprints/[sprintId]/page.tsx` — remove nav (29-61); keep back-link.

**Test plan**:
- Unit: `Sidebar.test.tsx` (new) — renders 4 links with correct hrefs; Keluar calls `adminLogout` + `router.push("/")`.
- Unit: `layout.test.tsx` (new) — layout renders sidebar + children.
- E2E: `admin-language.spec.ts` nav asserts (line 188, 192-193) updated to rail; verify navigation Dasbor↔Menu↔Pengaturan works.

**AC**:
- Left fixed rail visible on ALL admin pages (desktop-first).
- Rail items: Dasbor, Menu, Pengaturan, Keluar (Indonesian, capitalized).
- Keluar logs out (clears session cookie) and lands on `/`.
- No per-page top-pill nav remains; no dead/duplicate links.
- Sprints feature still reachable (see D1 — how "Riwayat" is exposed).

---

### ITEM 2 — Page title "Antrean Pesanan" + subtitle  [dashboard copy]

**Konteks**: Header currently shows "Dasbor Barista" + `/{tenantSlug} · auto-refresh 5s` (`page.tsx:208-211`). Stitch concept: title "Antrean Pesanan" + subtitle "Kelola pesanan masuk dan status operasional barista." (dashboard.html:156-157); auto-refresh demoted to small caption.

**Approach**: Change title + subtitle text; move "auto-refresh" to a muted caption (e.g. under subtitle: `Auto-refresh 5 detik`).

**Files changed**:
1. `src/app/admin/[tenantSlug]/page.tsx` — title/subtitle strings; auto-refresh caption (lines 208-211).

**Test plan**:
- E2E: `admin-language.spec.ts:187` heading assert → "Antrean Pesanan".
- Visual: subtitle + caption render (manual/E2E).

**AC**:
- H1 = "Antrean Pesanan".
- Subtitle = "Kelola pesanan masuk dan status operasional barista."
- Auto-refresh info shown as small muted caption, not in title.

---

### ITEM 3 — Header toggle "Buka Toko / Tutup Toko"  [dashboard header]

**Konteks**: No toggle in dashboard header today. Stitch header (dashboard.html:136-139) shows a segmented "Buka Toko / Tutup Toko" control. Backing already exists: `GET`/`PATCH /api/admin/settings` with `isOpen` (route.ts:79-82) + `fetchSettings`/`updateSettings` (admin-api.ts:136-147). Settings page already ships the same switch (settings/page.tsx:364-386) — proof of pattern.

**Approach**: Add a segmented toggle in the shared layout header (visible on all admin pages, matching Stitch). On mount `fetchSettings()` → `isOpen`; click → `updateSettings({ isOpen: !isOpen })` → reflect state; optimistic or busy state; surface error via inline notice. No backend change.

**Files changed**:
1. `src/app/admin/[tenantSlug]/layout.tsx` — toggle in header (or extract `src/components/admin/OpenToggle.tsx` — **NEW**, preferred for testability).
2. No API/client changes (reuse `fetchSettings`/`updateSettings`).

**Test plan**:
- Unit: `OpenToggle.test.tsx` (new) — renders current state from `isOpen`; click calls `updateSettings({isOpen: !isOpen})`; reflects new state; shows error on failure.
- E2E: extend `admin-language.spec.ts` or `admin-settings.spec.ts` — toggle on dashboard flips state, persists (reload), and reflects on settings page switch.

**AC**:
- Header shows "Buka Toko" / "Tutup Toko" segmented control reflecting `isOpen`.
- Clicking PATCHes `isOpen`; state updates; no full reload needed.
- Error surfaced (non-blocking notice) if PATCH fails.

---

### ITEM 4 — Order card action labels (Indonesian imperative)  [order card copy]

**Konteks**: Advance button renders `→ {STATUS_LABELS[next].toLowerCase()}` (`OrderCard.tsx:171`) → "→ dikonfirmasi" / "→ diracik" / "→ siap diambil" / "→ selesai" — past-participle, lowercase, inconsistent. Stitch concept uses imperative verbs: "Konfirmasi", "Tandai Lunas", "Selesai" (dashboard.html:194-264). "Tandai Lunas" already correct.

**Approach**: Add an imperative `ACTION_LABELS` map (distinct from `STATUS_LABELS`); render `→ {ACTION_LABELS[next]}`. Keep "Tandai Lunas" (UNPAID) and "Batal" (PENDING cancel). Also de-emoji the card (🔒💬✓ — CLAUDE.md forbids emojis).

Proposed `ACTION_LABELS` (advance):
- PENDING → CONFIRMED: **Konfirmasi**
- CONFIRMED → BREWING: **Mulai Meracik**
- BREWING → READY_FOR_PICKUP: **Tandai Siap**
- READY_FOR_PICKUP → PICKED_UP: **Selesai**

**Files changed**:
1. `src/types/admin.ts` — add `ACTION_LABELS: Record<OrderStatus, string>` (or `Partial`) for the advance verb.
2. `src/components/OrderCard.tsx` — button text `→ {ACTION_LABELS[next]}`; remove 🔒 (line 134), 💬 (line 141), ✓ (line 146) emojis.
3. `src/app/admin/[tenantSlug]/page.tsx` — drop the 🔒 emoji in the tip (see ITEM 5).

**Test plan**:
- Unit: `admin-types.test.ts` — add `ACTION_LABELS` coverage (imperative verbs, one per status transition).
- E2E: `admin-language.spec.ts` lines 211/215/218/225/228/231/237 → new verb labels; line 219 "🔒 Tandai..." → new no-emoji hint; line 224 "✓ Lunas" → "Lunas".

**AC**:
- Advance buttons show imperative verbs: "→ Konfirmasi", "→ Mulai Meracik", "→ Tandai Siap", "→ Selesai".
- "Tandai Lunas" (UNPAID→PAID) and "Batal" (PENDING cancel) unchanged.
- No emojis in card/hint copy.
- Notice text ("Pesanan dipindah ke …") unchanged (still `STATUS_LABELS[status].toLowerCase()`).

---

### ITEM 5 — Tip bar  [dashboard copy]

**Konteks**: Current tip `page.tsx:281-283`: "Tip: seret kartu untuk majukan statusnya. 🔒 Meracik butuh pembayaran LUNAS." Stitch concept tip (locked in task body): "Seret kartu untuk majukan status. Meracik (Brewing) membutuhkan pembayaran LUNAS."

**Approach**: Replace tip text; remove 🔒 emoji.

**Files changed**:
1. `src/app/admin/[tenantSlug]/page.tsx` — tip string (281-283).

**Test plan**:
- E2E: assert new tip text visible (extend admin-language.spec.ts).

**AC**:
- Tip = "Seret kartu untuk majukan status. Meracik (Brewing) membutuhkan pembayaran LUNAS."
- No emoji.

---

### ITEM 6 — PIN modal copy standardization  [dashboard copy]

**Konteks**: PIN modal (`page.tsx:286-333`) title/buttons already match concept ("Verifikasi PIN pengambilan", "Batal"/"Konfirmasi"). Body leaks raw enum: "…menandai pesanan sebagai PICKED_UP." (lines 293-294) — not Indonesian, not human-readable.

**Approach**: Replace raw enum with Indonesian; standardize capitalization/punctuation. Target body: "Masukkan PIN 4 digit pelanggan untuk menandai pesanan selesai."

**Files changed**:
1. `src/app/admin/[tenantSlug]/page.tsx` — modal body string (293-294).

**Test plan**:
- E2E: `admin-language.spec.ts:238` still asserts "Verifikasi PIN pengambilan"; add/verify no "PICKED_UP" literal rendered.
- `pickup-flow.spec.ts` (uses "Konfirmasi") unaffected.

**AC**:
- Modal body has no raw enum (`PICKED_UP`) — uses Indonesian "selesai".
- Title, buttons, error text remain as concept ("PIN tidak sesuai…" style).

---

## 2. EXECUTION ORDER (dependency graph)

```
Phase 1 — ITEM 1 (sidebar + layout)         [foundation, ~3h]
   └─ everything else renders inside the new layout/header

Phase 2 — ITEM 3 (header toggle)            [depends on Phase 1 header, ~1.5h]

Phase 3 — ITEM 2 + 5 + 6 (dashboard copy)   [same file page.tsx, ~1.5h]

Phase 4 — ITEM 4 (order card copy)          [OrderCard + types, ~2h]

Phase 5 — test updates (unit + e2e)         [depends on all copy final, ~2h]
```

Dispatch **sequentially** (1-per-1 per task body): T28-1 → T28-2 → T28-3 → T28-4 → T28-5.

---

## 3. PIONEER TICKET BREAKDOWN (estimasi jam)

| # | Ticket | Scope | Files | Hours | Deps |
|---|--------|-------|-------|-------|------|
| T28-1 | Sidebar rail + shared admin layout | ITEM 1 | layout.tsx (new), Sidebar.tsx (new), remove nav from 5 pages | 3h | — |
| T28-2 | Header Buka/Tutup Toko toggle | ITEM 3 | layout.tsx / OpenToggle.tsx (new) | 1.5h | T28-1 |
| T28-3 | Page title/subtitle + tip bar + PIN modal copy | ITEM 2+5+6 | page.tsx | 1.5h | T28-1 |
| T28-4 | Order card action labels + emoji cleanup | ITEM 4 | types/admin.ts, OrderCard.tsx | 2h | T28-1 |
| T28-5 | Unit + E2E test updates | all copy | admin-types.test.ts, Sidebar/OpenToggle tests, admin-language.spec.ts, admin-settings.spec.ts | 2h | T28-2..4 |

**Total ≈ 10h (~1.5–2 hari pioneer).**

---

## 4. OUT OF SCOPE (JANGAN sentuh — verified)

- Mobile dashboard (customer shopfront is mobile-first, admin is desktop-first — untouched).
- Item modifiers (OrderCard already renders denormalized items only; no modifier UI change).
- E-wallet payments / QR share / link kedai.
- Order-type (Dine In / Takeaway) — Stitch shows it, but it is NOT backed (no field in `Order` type) → **do not add**.
- Order-code format: keep hex `#<id.slice(0,8)>` (OrderCard.tsx:82) — do NOT switch to `#ORD-882` (data format change).
- Search bar + notifications icon in header — dead UI, no backing feature → SKIP (locked).
- Board layout: keep kanban columns + drag-advance; do NOT switch to list+tabs (locked).
- Schema/API changes beyond reuse of `PATCH isOpen`.
- Filter tabs (Semua/Menunggu/Aktif) in Stitch concept — do NOT add (locked: keep kanban).

---

## 5. OPEN DECISIONS FOR PM (blocking before impl)

**D1 (BLOCKING) — "Riwayat" (sprints) has no slot in the 4-item sidebar.** The locked sidebar is Dasbor/Menu/Pengaturan/Keluar, but `Riwayat` (sprints, T15) is a real feature. Options: (a) add "Riwayat" as a 5th rail item; (b) nest sprints under Pengaturan; (c) accept the feature becoming URL-only (bad). **Recommend (a).**

**D2 — "Lihat Toko ↗" (view customer storefront) dropped.** Stitch sidebar omits it. Recommend drop (customer view reachable via `/` landing + open-in-new-tab not needed for barista), but confirm.

**D3 — PENDING badge "Pending" → "Menunggu Konfirmasi"?** V3 above. Recommend align to Indonesian ("Menunggu Konfirmasi") for consistency with customer page + Stitch concept; this overrides the T25-1 "Pending unchanged" test (`admin-types.test.ts:32`) and e2e (`admin-language.spec.ts:196,209`). If PM prefers to keep "Pending", note it as a known accepted exception.

**D4 — "Pembayaran" → "Pengaturan" rename.** Sidebar says "Pengaturan" but settings page title is "Pengaturan Pembayaran" and now also holds Jam Operasional + Sprint duration. Recommend renaming page title to "Pengaturan". Minor, optional.

**D5 — "Diracik" (status badge) vs "Meracik" (tip/action verb) wording.** Tip says "Meracik (Brewing)", badge says "Diracik", action verb "Mulai Meracik". State vs action is acceptable but flagging for consistency sign-off.

**D6 — Toggle scope: global (all admin pages) vs dashboard-only.** This plan puts it in the shared layout header (global, matches Stitch). If PM prefers dashboard-only, it moves to `page.tsx` header instead. Confirm placement.

---

## 6. TEST IMPACT SUMMARY (exact asserts to update)

- `tests/admin-types.test.ts:32` — `STATUS_LABELS.PENDING` assert (if D3 approved → "Menunggu Konfirmasi"); add `ACTION_LABELS` tests.
- `e2e/admin-language.spec.ts` — heading (187), nav labels (188, 192, 193), badges (196, 209), advance buttons (211, 215, 218, 225, 228, 231, 237), hint (219), "✓ Lunas" (224).
- `e2e/admin-settings.spec.ts` — verify no regression on settings page (its "Status kedai" switch stays; title rename if D4).
- `e2e/pickup-flow.spec.ts` — "Konfirmasi" / "Selesai" asserts unaffected (PIN modal + status label unchanged).
