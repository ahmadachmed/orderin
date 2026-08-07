/**
 * Shared view types for the public (customer-facing) frontend.
 * Plain JSON-serializable shapes — Decimal/Dates are converted server-side.
 */
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "BREWING"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "CANCELLED";

export type PaymentStatus = "UNPAID" | "PAID";
export type PaymentMethod = "qris" | "bank_transfer" | "cash";

/** Tenant summary shown on the landing page (shop list). */
export interface TenantSummary {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

/** Menu item as rendered on the shop menu page. price is a plain number (IDR). */
export interface MenuItemView {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  prepTimeSeconds: number;
  sortOrder: number;
}

/** A line in the customer's cart. */
export interface CartLine {
  menuItemId: string;
  quantity: number;
}

/** Tenant payment config for the order status page. */
export interface TenantPaymentView {
  name: string;
  slug: string;
  qrisCode: string | null;
  qrisImageUrl: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
}

/** Order status page payload (initial server render + poll response shape). */
export interface StatusLogEntry {
  id: string;
  status: OrderStatus;
  actorType: string | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderStatusView {
  orderId: string;
  status: OrderStatus;
  pickupCode?: string | null;
  etaSeconds: number | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  customerTransferNote: string | null;
  createdAt: string;
  customerName: string;
  /** Null when the customer is logged in — the "Buat akun" banner (T17-7)
   *  renders only when this is present (i.e. guest + active order). */
  customerPhone: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    prepTimeSeconds: number;
  }>;
  total: number;
  statusLogs?: StatusLogEntry[];
  tenant: TenantPaymentView;
}
