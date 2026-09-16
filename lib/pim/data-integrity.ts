// A3.5E-P2-F, Section 15: FOREIGN_PRODUCT_DESCRIPTION_CONTEXT / DATA
// INTEGRITY GATE. SKU 112471 "Varal De Chão Japonês 1,40m Com Abas Osaka -
// Overtime" has a description that is entirely about "Fita Isolante Adere
// 20 metros" — a completely different product (electrical tape), not the
// clothes rack the title names. No text-only exclusion rule can fix this:
// taken on its own, "Fabricada com PVC de alta qualidade" is a perfectly
// well-formed, positively-signaled material claim. The defect is that the
// description does not belong to this product at all.
//
// This is deliberately NOT an auto-blocking rule (Section 15: "não gerar
// falso positivo apenas porque descrição menciona acessórios... Se não
// houver confiança suficiente: não bloquear automaticamente; marcar para
// revisão"). It is a conservative, narrow, best-effort signal: it fires
// only when NONE of the title's core content words appear anywhere in the
// description at all. A legitimate description that simply paraphrases the
// title without repeating its exact words is an accepted false-negative —
// this signal is meant to catch gross mismatches (a different product
// family entirely), not stylistic paraphrase, and callers must route a
// positive result to human review rather than treating it as a hard block.

const STOPWORDS=new Set(["de","da","do","das","dos","com","para","em","por","sem","uma","um","umas","uns","que","the","and"]);

function stripAccents(value:string):string{
 return value.normalize("NFD").replace(/[̀-ͯ]/g,"");
}

function coreTitleWords(title:string):string[]{
 return stripAccents(title.toLocaleLowerCase("pt-BR")).replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(word=>word.length>=4&&!STOPWORDS.has(word)).slice(0,2);
}

export type DataIntegritySignal={suspected:boolean;titleCoreWords:string[]};

// Conservative on purpose: requires a substantial description (short/empty
// descriptions are never flagged — there is not enough text to judge a
// mismatch) and requires ALL extracted core title words to be absent, not
// just one, to avoid flagging legitimate products whose description
// happens to omit a single title word.
export function detectDataIntegritySuspicion(title:string,description:string|null):DataIntegritySignal{
 const plainDescription=description?stripAccents(description.toLocaleLowerCase("pt-BR")).replace(/<[^>]+>/g," "):"";
 const titleCoreWords=coreTitleWords(title);
 if(plainDescription.trim().length<80||titleCoreWords.length===0)return{suspected:false,titleCoreWords};
 const suspected=titleCoreWords.every(word=>!plainDescription.includes(word));
 return{suspected,titleCoreWords};
}
