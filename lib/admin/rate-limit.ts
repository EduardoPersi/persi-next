import {createHmac} from "node:crypto";import {sql} from "drizzle-orm";import {getDatabase} from "@/lib/db";
export const ADMIN_RATE_POLICIES={"admin.login":{limit:8,windowSeconds:900},"admin.mfa.enroll":{limit:3,windowSeconds:900},"admin.mfa.verify":{limit:6,windowSeconds:300},"admin.mutation":{limit:30,windowSeconds:60},"admin.security":{limit:5,windowSeconds:300}} as const;
export type AdminRateLimitKey={identitySubject:string;operation:string};
export interface AdminRateLimiter{consume(key:AdminRateLimitKey):Promise<boolean>}
export class MemoryAdminRateLimiter implements AdminRateLimiter{
 private counters=new Map<string,{count:number;resetAt:number}>();
 private readonly limit:number;private readonly windowMs:number;private readonly now:()=>number;
 constructor(limit=10,windowMs=60_000,now=()=>Date.now()){this.limit=limit;this.windowMs=windowMs;this.now=now}
 async consume(input:AdminRateLimitKey){const key=`${input.identitySubject}:${input.operation}`,time=this.now(),old=this.counters.get(key),value=!old||old.resetAt<=time?{count:0,resetAt:time+this.windowMs}:old;value.count++;this.counters.set(key,value);return value.count<=this.limit}
}
export function adminRateKey(value:string){const secret=process.env.ADMIN_RATE_LIMIT_HMAC_SECRET;if(!secret||secret.length<32)throw new Error("ADMIN_RATE_LIMIT_UNAVAILABLE");return createHmac("sha256",secret).update(value.trim().toLowerCase()).digest("hex")}
export async function enforceAdminRateLimit(key:AdminRateLimitKey,limiter?:AdminRateLimiter){if(limiter){if(!await limiter.consume(key))throw new Error("ADMIN_RATE_LIMITED");return}const operation=(key.operation.startsWith("pim.")?"admin.mutation":key.operation) as keyof typeof ADMIN_RATE_POLICIES,policy=ADMIN_RATE_POLICIES[operation];if(!policy)throw new Error("ADMIN_RATE_LIMIT_UNAVAILABLE");try{const rows=await getDatabase().execute(sql`select * from consume_admin_rate_limit(${adminRateKey(key.identitySubject)},${operation},${policy.limit},${policy.windowSeconds})`),result=(rows as unknown as {allowed:boolean}[])[0];if(!result?.allowed)throw new Error("ADMIN_RATE_LIMITED")}catch(error){if(error instanceof Error&&error.message==="ADMIN_RATE_LIMITED")throw error;throw new Error("ADMIN_RATE_LIMIT_UNAVAILABLE")}}
