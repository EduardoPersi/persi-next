export const STOCK_POLICY_VERSION="2026-07";
export const STOCK_POLICY_PATH="/politica-de-privacidade-e-seguranca";
export function parseBrowserStockSubscription(value:unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("invalid");
  const body=value as Record<string,unknown>; const keys=Object.keys(body).sort().join(",");
  if(!["consent,email,productId,website","consent,email,productId,variationId,website"].includes(keys)||!Number.isInteger(body.productId)||Number(body.productId)<1||(body.variationId!==undefined&&(!Number.isInteger(body.variationId)||Number(body.variationId)<0))||typeof body.email!=="string"||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())||body.website!==""||body.consent!==true) throw new Error("invalid");
  return {productId:Number(body.productId),variationId:body.variationId===undefined?0:Number(body.variationId),email:body.email.trim().toLowerCase(),website:"",consent:true as const};
}
export function parseStockToken(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).join(",")!=="token"||typeof (value as {token?:unknown}).token!=="string"||!/^[A-Za-z0-9_-]{40,128}$/.test((value as {token:string}).token))throw new Error("invalid");return (value as {token:string}).token;}
