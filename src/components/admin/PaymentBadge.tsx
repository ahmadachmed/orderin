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
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
      }`}
    >
      {paid ? "● Paid" : "○ Unpaid"}
    </span>
  );
}
