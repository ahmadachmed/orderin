/**
 * Menu item field extraction + validation, shared by the admin menu
 * routes (POST /api/admin/menu, PATCH /api/admin/menu/[itemId]).
 * Kept out of route files because Next.js route modules may only export
 * HTTP handlers and route config.
 */
import { HttpError } from "@/lib/api";

/** Extract + validate menu item fields from a JSON body. */
export function parseMenuFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "name must be a non-empty string");
    }
    data.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new HttpError(400, "description must be a string or null");
    }
    data.description = body.description;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new HttpError(400, "price must be a non-negative number");
    }
    data.price = price;
  }
  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && typeof body.imageUrl !== "string") {
      throw new HttpError(400, "imageUrl must be a string or null");
    }
    data.imageUrl = body.imageUrl;
  }
  if (body.prepTimeSeconds !== undefined) {
    const prep = Math.floor(Number(body.prepTimeSeconds));
    if (!Number.isFinite(prep) || prep < 0) {
      throw new HttpError(400, "prepTimeSeconds must be a non-negative integer");
    }
    data.prepTimeSeconds = prep;
  }
  if (body.isAvailable !== undefined) {
    if (typeof body.isAvailable !== "boolean") {
      throw new HttpError(400, "isAvailable must be a boolean");
    }
    data.isAvailable = body.isAvailable;
  }
  if (body.sortOrder !== undefined) {
    const sort = Math.floor(Number(body.sortOrder));
    if (!Number.isFinite(sort)) throw new HttpError(400, "sortOrder must be an integer");
    data.sortOrder = sort;
  }
  return data;
}
