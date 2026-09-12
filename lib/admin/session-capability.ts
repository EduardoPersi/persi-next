import {createHmac} from "node:crypto";

function secret(){const value=process.env.ADMIN_SESSION_HMAC_SECRET;if(!value||value.length<32)throw new Error("ADMIN_SESSION_UNAVAILABLE");return value}
export function hashAdminSessionCapability(value:string){return createHmac("sha256",secret()).update(value).digest("hex")}
export function validAdminSessionCapability(value:unknown):value is string{return typeof value==="string"&&/^[A-Za-z0-9_-]{43}$/.test(value)}
