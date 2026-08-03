/**
 * PATCH /api/admin/settings — update the admin's own tenant settings.
 * PLAN §9.2 (§3.3: hours, pause toggle, payment config, max queue).
 * Tenant model is unscoped by design (no tenantId filter); the target id
 * comes from the verified session, never from the request body.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, HttpError, readJson } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

export async function PATCH(req: NextRequest) {
  const session = getSession();
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
        openTime: true,
        closeTime: true,
        timezone: true,
        maxQueueSize: true,
        prepTimeBuffer: true,
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
