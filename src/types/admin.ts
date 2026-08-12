// Shared admin types for the barista dashboard (T4).
// Shapes mirror PLAN.md §7 Prisma models + §9.2 admin API contract.
// The wire format of T2's admin endpoints is normalized here so the UI
// is resilient to `{ orders: [...] }` vs bare-array responses.

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "BREWING"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "CANCELLED";

export type PaymentStatus = "UNPAID" | "PAID";
export type PaymentMethod = "qris" | "bank_transfer" | "cash";

export interface OrderItem {
  id: string;
  menuItemId: string;
  name?: string; // denormalized from menuItem (if API includes it)
  quantity: number;
  unitPrice: number | string; // Decimal serialized as string
}

export interface OrderStatusLog {
  id: string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus | null;
  actorType?: "BARISTA" | "CUSTOMER" | null;
  actorName?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  tenantId: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  pickupCode: string;
  etaSeconds?: number | null;
  paymentStatus: PaymentStatus;
  paidAt?: string | null;
  paymentMethod?: PaymentMethod | null;
  customerTransferNote?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: OrderItem[];
  statusLogs?: OrderStatusLog[];
}

export interface MenuItem {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  price: number | string;
  imageUrl?: string | null;
  prepTimeSeconds: number;
  isAvailable: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenantSettings {
  id: string;
  slug: string;
  name: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  timezone: string;
  maxQueueSize: number;
  prepTimeBuffer: number;
  sprintDurationDays: number;
  qrisImageUrl?: string | null;
  qrisCode?: string | null;
  bankAccountNumber?: string | null;
  bankName?: string | null;
}

// Status flow for the kanban columns (issue #5). CANCELLED is handled
// as a card action, not a drop column.
export const STATUS_FLOW: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "BREWING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Dikonfirmasi",
  BREWING: "Diracik",
  READY_FOR_PICKUP: "Siap Diambil",
  PICKED_UP: "Selesai",
  CANCELLED: "Dibatalkan",
};

// Payment gate: brewing may only start once payment is confirmed (PLAN §3.1.1).
export function canAdvanceToBrewing(paymentStatus: PaymentStatus): boolean {
  return paymentStatus === "PAID";
}

// Auto-reminder threshold (issue #5): highlight orders stuck in a status
// longer than this many minutes.
export const STUCK_MINUTES = 10;

export function isStuck(order: Order, now: Date = new Date()): boolean {
  const logs = order.statusLogs ?? [];
  // Time the order entered its current status: latest log matching status,
  // falling back to updatedAt.
  let enteredAt: Date | null = null;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].status === order.status) {
      enteredAt = new Date(logs[i].createdAt);
      break;
    }
  }
  const ref = enteredAt ?? new Date(order.updatedAt);
  const mins = (now.getTime() - ref.getTime()) / 60000;
  return mins >= STUCK_MINUTES && order.status !== "PICKED_UP" && order.status !== "CANCELLED";
}

export function formatPrice(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

// ── Sprint (T15, PLAN §4) ────────────────────────────────────────────────────

export type SprintStatus = "OPEN" | "CLOSED";

/** Row shape of GET /api/admin/sprints (PLAN §2.3/§4.5). */
export interface SprintSummary {
  id: string;
  startAt: string;
  endAt: string | null;
  status: SprintStatus;
  closedAt: string | null;
  orderCount: number;
  revenue: number;
}

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  OPEN: "Buka",
  CLOSED: "Tutup",
};
