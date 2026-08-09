/**
 * PATCH /api/order/[orderId]/payment — customer payment actions (issue #4).
 * Public (no auth — the orderId UUID is the customer's bearer token).
 *
 * Body: { paymentMethod?: "qris" | "bank_transfer" | "cash",
 *         customerTransferNote?: string }
 * - Selecting a method just records the choice (paymentStatus stays UNPAID).
 * - For bank_transfer the customer may also mark "I have paid" with an
 *   optional transfer note; the barista still verifies + marks PAID in the
 *   dashboard (PLAN §3.1.1 — manual confirmation, advisory).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PaymentMethod } from "@/types";

export const dynamic = "force-dynamic";

const METHODS = new Set<string>(["qris", "bank_transfer", "cash"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : undefined;
  const note =
    typeof body.customerTransferNote === "string" ? body.customerTransferNote.trim() : undefined;

  if (paymentMethod !== undefined && !METHODS.has(paymentMethod)) {
    return NextResponse.json(
      { error: "paymentMethod must be qris, bank_transfer or cash" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ error: "Order already paid" }, { status: 409 });
  }

  // Only the "I have paid" action (bank transfer) may attach a note.
  const update: { paymentMethod?: PaymentMethod; customerTransferNote?: string | null } = {};
  if (paymentMethod) update.paymentMethod = paymentMethod as PaymentMethod;
  if (note) update.customerTransferNote = note;
  else if (paymentMethod === "bank_transfer" && body.customerTransferNote === "") {
    update.customerTransferNote = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: update,
    select: {
      id: true,
      paymentMethod: true,
      customerTransferNote: true,
      paymentStatus: true,
    },
  });

  // Audit trail (issue #7): log the customer's "I have paid" claim (advisory —
  // barista verification is authoritative and logged separately via the admin
  // dashboard when marking PAID).
  if (note) {
    await prisma.orderStatusLog.create({
      data: {
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        actorType: "CUSTOMER",
        actorName: order.customerName,
        note: `Customer marked "I have paid"${note ? ` — ${note}` : ""}`,
      },
    });
  }

  return NextResponse.json(updated);
}
