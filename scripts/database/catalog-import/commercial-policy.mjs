function decimalParts(value){const match=String(value??"").trim().match(/^(\d+)(?:\.(\d+))?$/);if(!match)return null;return{whole:BigInt(match[1]),fraction:match[2]??""};}
export function decimalToMinor(value,policy="half_up"){
  const parts=decimalParts(value);if(!parts)return String(value??"").trim()?undefined:null;const kept=parts.fraction.slice(0,2).padEnd(2,"0"),discarded=parts.fraction.slice(2);let minor=parts.whole*100n+BigInt(kept);if(!discarded||/^0+$/.test(discarded))return minor;
  const first=Number(discarded[0]),restNonZero=/[1-9]/.test(discarded.slice(1));if(policy==="half_up"&&first>=5)minor+=1n;else if(policy==="half_even"&&(first>5||(first===5&&(restNonZero||minor%2n===1n))))minor+=1n;else if(policy!=="truncate"&&policy!=="half_up"&&policy!=="half_even")throw new Error("MONEY_POLICY_UNKNOWN");return minor;
}
export function resolveGtinPolicy(entity,{duplicateGtins=new Set()}={}){
  const native=String(entity.global_unique_id??"").trim(),legacy=String((entity.meta_data??[]).find((x)=>x.key==="hwp_product_gtin")?.value??"").trim();const selected=native||legacy||null;
  if(selected&&duplicateGtins.has(selected))return{value:null,status:"duplicate_unresolved",candidates:[selected],authority:native?"global_unique_id":"legacy"};
  if(native&&legacy&&native!==legacy)return{value:native,status:"resolved_native_precedence",candidates:[native,legacy],authority:"global_unique_id"};
  return{value:selected,status:selected?"selected":"missing",authority:native?"global_unique_id":legacy?"legacy":null};
}
