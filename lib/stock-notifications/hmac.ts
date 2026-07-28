import { createHash, createHmac, randomBytes } from "node:crypto";
export type StockHmacConfig = { secret: string; keyId: string; origin: string };
export function signStockRequest(input:{path:string;rawBody:string},config:StockHmacConfig,options:{timestamp?:string;nonce?:string}={}) {
  const timestamp=options.timestamp??String(Math.floor(Date.now()/1000));
  const nonce=options.nonce??randomBytes(16).toString("base64url");
  const canonical=["POST",input.path,timestamp,nonce,config.origin,createHash("sha256").update(input.rawBody,"utf8").digest("hex")].join("\n");
  const signature=createHmac("sha256",config.secret).update(canonical,"utf8").digest("hex");
  return {canonical,headers:{"X-Persi-Key-Id":config.keyId,"X-Persi-Timestamp":timestamp,"X-Persi-Nonce":nonce,"X-Persi-Origin":config.origin,"X-Persi-Signature":`v1=${signature}`}};
}
