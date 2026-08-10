export const NEWSLETTER_POLICY_VERSION="2026-07";
export const NEWSLETTER_POLICY_PATH="/politica-de-privacidade-e-seguranca";
export function parseBrowserNewsletterSubscription(value:unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("invalid");
  const body=value as Record<string,unknown>; const keys=Object.keys(body).sort().join(",");
  if(keys!=="consent,email,recaptchaToken,website"||typeof body.email!=="string"||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())||body.website!==""||body.consent!==true||typeof body.recaptchaToken!=="string"||body.recaptchaToken.length>8192) throw new Error("invalid");
  return {email:body.email.trim().toLowerCase(),website:"",consent:true as const,recaptchaToken:body.recaptchaToken};
}
export function parseNewsletterToken(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).join(",")!=="token"||typeof (value as {token?:unknown}).token!=="string"||!/^[A-Za-z0-9_-]{40,128}$/.test((value as {token:string}).token))throw new Error("invalid");return (value as {token:string}).token;}
