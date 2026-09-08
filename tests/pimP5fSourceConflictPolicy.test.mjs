import test from "node:test";
import assert from "node:assert/strict";
import {PimAttributeExtractor} from "../lib/pim/extractor.ts";
import {conflictComparisonKey} from "../lib/pim/source-conflict-policy.ts";

const context=(title,description="",attributes=[])=>({productId:"synthetic",title,description,brand:null,category:null,sku:"",gtin:null,attributes});
const extract=(title,description="",attributes=[])=>new PimAttributeExtractor().extract(context(title,description,attributes));
const candidate=(items,attribute)=>items.find(item=>item.attribute===attribute);

test("normalizacao compara valores equivalentes sem alterar compound historico",()=>{
 assert.equal(conflictComparisonKey("25 mm"),conflictComparisonKey("25mm"));
 assert.equal(conflictComparisonKey("4,00mm"),conflictComparisonKey("4mm"));
 assert.equal(conflictComparisonKey("60 x 25mm"),conflictComparisonKey("60mm x 25mm"));
 assert.equal(candidate(extract("Luva 32 x 25mm"),"bitola").value,"32 x 25mm");
});

test("compound misto permanece atomico",()=>{
 for(const value of ['25mm x 1/2"','16mm x 1/2"']){
  const item=candidate(extract(`Adaptador ${value}`),"bitola");
  assert.equal(item.value,value);assert.equal(item.status,"CANDIDATE");
 }
});

test("unidades sao classificadas lexicalmente sem falsos diameter/current/voltage",()=>{
 const items=extract("Bomba 0,75CV 110v 1,2kg", "Indicada para a obra");
 assert.equal(candidate(items,"power").value,"0,75CV");
 assert.equal(candidate(items,"voltage").value,"110V");
 assert.equal(items.some(item=>item.value.includes("kg")),false);
 assert.equal(items.some(item=>item.attribute==="current"),false);
});

test("papeis entrada saida e produto embalagem separam valores",()=>{
 const io=extract("Adaptador", "Entrada 32mm e saída 25mm");
 assert.equal(candidate(io,"diameter").sourceConflictDecision,"SEMANTIC_ROLE_SEPARATION");
 assert.equal(candidate(io,"diameter").status,"CANDIDATE");
 const dimensions=extract("Peça 20mm", "Produto 20mm; embalagem 150mm");
 assert.equal(candidate(dimensions,"diameter").sourceConflictDecision,"SEMANTIC_ROLE_SEPARATION");
});

test("materiais e cores de produto/componente nao viram contradicao",()=>{
 assert.equal(candidate(extract("Corpo PVC", "Produto em PVC com anel de borracha"),"material").status,"CANDIDATE");
 assert.equal(candidate(extract("Produto branco", "Produto branco com componente preto"),"color").sourceConflictDecision,"SEMANTIC_ROLE_SEPARATION");
});

test("variantes enumeradas permanecem multi-value sem inferir bivolt",()=>{
 const voltage=candidate(extract("Versões 127V / 220V"),"voltage");
 assert.equal(voltage.sourceConflictDecision,"LEGITIMATE_MULTI_VALUE");
 assert.equal(voltage.value.includes("bivolt"),false);
 assert.equal(voltage.status,"CANDIDATE");
});

test("atributos estruturados contraditorios e desconhecidos continuam fail-closed",()=>{
 const structured=candidate(extract("Produto", "",[{name:"Cor",value:"Preto"},{name:"Cor",value:"Verde"}]),"color");
 assert.equal(structured.sourceConflictDecision,"TRUE_SOURCE_CONTRADICTION");
 assert.equal(structured.status,"CONFLICT");
 const ambiguous=candidate(extract("Peça 25mm", "Medida 32mm"),"diameter");
 assert.equal(ambiguous.sourceConflictDecision,"UNRESOLVED_AMBIGUITY");
 assert.equal(ambiguous.status,"CONFLICT");
});

test("range e compatibilidade usam papeis sem escolher valor silenciosamente",()=>{
 const current=candidate(extract("Dispositivo 10A", "Faixa de 10A a 20A"),"current");
 assert.ok(["LEGITIMATE_MULTI_VALUE","SEMANTIC_ROLE_SEPARATION"].includes(current.sourceConflictDecision));
 const thread=candidate(extract('Adaptador rosca macho 1/2"', 'Saída fêmea 3/4"'),"thread");
 assert.equal(thread.sourceConflictDecision,"SEMANTIC_ROLE_SEPARATION");
});
