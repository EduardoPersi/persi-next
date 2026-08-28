import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";

export type PimDecision = "approved" | "rejected";

export async function decidePimSuggestion(input:{suggestionId:string;decision:PimDecision;actorReference:string;reason?:string}){
  if(!/^[0-9a-f-]{36}$/i.test(input.suggestionId))throw new Error("Sugestão inválida.");
  if(!input.actorReference.trim())throw new Error("Ator da decisão é obrigatório.");
  return getDatabase().transaction(async(tx)=>{
    const locked=await tx.execute(sql`select id,product_id,field_name,suggested_value,status::text from pim_suggestions where id=${input.suggestionId}::uuid for update`);
    const suggestion=(locked as unknown as Array<{id:string;product_id:string;field_name:string;suggested_value:string;status:string}>)[0];
    if(!suggestion)throw new Error("Sugestão não encontrada.");
    if(suggestion.status!=="needs_review")throw new Error("Sugestão já revisada.");
    await tx.execute(sql`update pim_suggestions set status=${input.decision}::pim_decision_status,reviewed_by=${input.actorReference},reviewed_at=now() where id=${input.suggestionId}::uuid`);
    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason)
      values(${suggestion.product_id}::uuid,'suggestion',${suggestion.id}::uuid,${suggestion.field_name},'needs_review',${input.decision},'manual',${input.actorReference},${`suggestion_${input.decision}`},${input.reason??null})`);
    return {productId:suggestion.product_id,decision:input.decision};
  });
}
