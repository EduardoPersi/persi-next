import { NextResponse } from "next/server";
import { MAX_CATALOG_WEBHOOK_BYTES, parseWooWebhookSignal, verifyWooWebhookSignature } from "@/lib/catalog/webhookSecurity";
import { enqueueWooCatalogSignal } from "@/services/catalog/inbox";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return NextResponse.json({ message: "Payload inválido." }, { status: 415 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_CATALOG_WEBHOOK_BYTES) return NextResponse.json({ message: "Payload inválido." }, { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_CATALOG_WEBHOOK_BYTES) return NextResponse.json({ message: "Payload inválido." }, { status: 413 });
  const secret = process.env.CATALOG_SYNC_WEBHOOK_SECRET ?? "";
  if (!verifyWooWebhookSignature(raw, request.headers.get("x-wc-webhook-signature"), secret)) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ message: "Payload inválido." }, { status: 400 }); }
  const signal = parseWooWebhookSignal(payload);
  const topic = request.headers.get("x-wc-webhook-topic") ?? "";
  const delivery = request.headers.get("x-wc-webhook-delivery-id") ?? "";
  if (!signal || !delivery || !/^product\.(created|updated|deleted|restored)$/.test(topic)) return NextResponse.json({ message: "Evento inválido." }, { status: 422 });
  await enqueueWooCatalogSignal({ topic, deliveryId: delivery, ...signal, rawBody: raw });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
