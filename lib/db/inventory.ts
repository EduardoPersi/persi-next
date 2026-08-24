import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "./connection";
import type { InventoryReservationRow } from "./schema";

export interface ReserveInventoryInput {
  inventoryLevelId: string;
  quantity: bigint;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  expiresAt: Date;
  sourceSystem?: string;
}

export async function reserveInventory(
  input: ReserveInventoryInput,
): Promise<InventoryReservationRow> {
  const result = await getDatabase().execute<InventoryReservationRow>(sql`
    select * from public.reserve_inventory(
      ${input.inventoryLevelId}::uuid,
      ${input.quantity}::bigint,
      ${input.referenceType}::text,
      ${input.referenceId}::text,
      ${input.idempotencyKey}::text,
      ${input.expiresAt.toISOString()}::timestamptz,
      ${input.sourceSystem ?? "persi"}::text
    )
  `);
  const reservation = result[0];
  if (!reservation) throw new Error("A reserva não retornou resultado.");
  return reservation;
}
