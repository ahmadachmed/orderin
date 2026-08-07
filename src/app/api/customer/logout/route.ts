import { NextResponse } from "next/server";
import { clearCustomerSessionCookie } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearCustomerSessionCookie());
  return res;
}
