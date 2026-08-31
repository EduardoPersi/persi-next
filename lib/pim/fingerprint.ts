import {createHash} from "node:crypto";
import type {PimEnrichmentContext} from "./enrichment-types.ts";
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return typeof value==="string"?value.trim():value;}
export function createPimSourceFingerprint(context:PimEnrichmentContext){return createHash("sha256").update(JSON.stringify(canonical(context))).digest("hex");}
