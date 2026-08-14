/**
 * GET /api/admin/settings — read the admin's own tenant settings (issue #7).
 * Returns the full settings object incl. payment config (QRIS + bank) so the
 * admin settings page can prefill the form.
 * PATCH /api/admin/settings — update tenant settings (store info, hours, queue,
 * payment config). PLAN §9.2.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SETTINGS_SELECT = {
  id: true,
  slug: true,
  name: true,
  address: true,
  phone: true,
  logoUrl: true,
  isOpen: true,
  isOpenOverrideUntil: true,
  openTime: true,
  closeTime: true,
  timezone: true,
  maxQueueSize: true,
  prepTimeBuffer: true,
  sprintDurationDays: true,
  qrisImageUrl: true,
  qrisCode: true,
  bankAccountNumber: true,
  bankName: true,
} as const;

const STRING_FIELDS = [
  "name",
  "address",
  "phone",
  "logoUrl",
  "openTime",
  "closeTime",
  "timezone",
  "qrisImageUrl",
  "qrisCode",
  "bankAccountNumber",
  "bankName",
] as const;

export async function GET() {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: SETTINGS_SELECT,
  });
  if (!tenant) return fail("Tenant not found", 404);

  return ok(tenant);
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Unauthorized", 401);

  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body", 400);

  const data: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined) {
      if (body[field] !== null && typeof body[field] !== "string") {
        return fail(`${field} must be a string or null`, 400);
      }
      data[field] = body[field];
    }
  }
  if (body.isOpen !== undefined) {
    if (typeof body.isOpen !== "boolean") return fail("isOpen must be a boolean", 400);
    data.isOpen = body.isOpen;
  }
  // #207 v2 — time-boxed toggle override. Null clears the override (back to
  // pure schedule); an ISO string must parse, otherwise reject.
  if (body.isOpenOverrideUntil !== undefined) {
    if (body.isOpenOverrideUntil === null) {
      data.isOpenOverrideUntil = null;
    } else if (typeof body.isOpenOverrideUntil === "string") {
      const d = new Date(body.isOpenOverrideUntil);
      if (Number.isNaN(d.getTime())) {
        return fail("isOpenOverrideUntil must be an ISO date string or null", 400);
      }
      data.isOpenOverrideUntil = d;
    } else {
      return fail("isOpenOverrideUntil must be an ISO date string or null", 400);
    }
  }
  if (body.maxQueueSize !== undefined) {
    const n = Math.floor(Number(body.maxQueueSize));
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return fail("maxQueueSize must be an integer 1-1000", 400);
    }
    data.maxQueueSize = n;
  }
  if (body.prepTimeBuffer !== undefined) {
    const n = Math.floor(Number(body.prepTimeBuffer));
    if (!Number.isFinite(n) || n < 0 || n > 600) {
      return fail("prepTimeBuffer must be an integer 0-600 (minutes)", 400);
    }
    data.prepTimeBuffer = n;
  }
  if (body.sprintDurationDays !== undefined) {
    const n = Math.floor(Number(body.sprintDurationDays));
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      return fail("sprintDurationDays must be an integer 1-90", 400);
    }
    data.sprintDurationDays = n;
  }

  // SETTINGS-03: openTime/closeTime must be HH:mm (e.g. 07:00, 21:30).
  // Without this, invalid values silently break isWithinHours() in lib/time.ts.
  const HH_MM = /^\d{2}:\d{2}$/;
  if (body.openTime !== undefined && body.openTime !== null && !HH_MM.test(body.openTime as string)) {
    return fail("openTime must be HH:mm format", 400);
  }
  if (body.closeTime !== undefined && body.closeTime !== null && !HH_MM.test(body.closeTime as string)) {
    return fail("closeTime must be HH:mm format", 400);
  }

  if (Object.keys(data).length === 0) return fail("Nothing to update", 400);

  try {
    const tenant = await prisma.tenant.update({
      where: { id: session.tenantId },
      data,
      select: {
        id: true,
        slug: true,
        name: true,
        isOpen: true,
        isOpenOverrideUntil: true,
        openTime: true,
        closeTime: true,
        timezone: true,
        maxQueueSize: true,
        prepTimeBuffer: true,
        sprintDurationDays: true,
        qrisImageUrl: true,
        qrisCode: true,
        bankAccountNumber: true,
        bankName: true,
      },
    });
    return ok(tenant);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    throw e;
  }
}
