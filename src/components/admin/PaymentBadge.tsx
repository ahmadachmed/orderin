// Payment badge for order cards (admin dashboard).
import type { PaymentStatus } from "@/types/admin";

export default function PaymentBadge({
  paymentStatus,
}: {
  paymentStatus: PaymentStatus;
}) {
  const paid = paymentStatus === "PAID";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        paid
          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
          : "bg-orange-100 text-orange-700 border-orange-300"
      }`}
    >
      {paid ? "● Paid" : "○ Unpaid"}
    </span>
  );
}
