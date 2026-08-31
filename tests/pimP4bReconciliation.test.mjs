import assert from "node:assert/strict";
import test from "node:test";
import {PimAttributeExtractor} from "../lib/pim/extractor.ts";
import {reconcileEnrichmentOutput} from "../lib/pim/conflict-reconciliation.ts";

test("reconciliação canônica aceita capitalização sem corromper palavras com x",()=>{
 const deterministic=new PimAttributeExtractor().extract({productId:"local",title:'Adaptador Soldável 25X3/4"',description:'Conexão soldável com diâmetro de 25mm x 3/4" em PVC.',brand:"Fortlev",category:"Água fria",sku:"",gtin:null,attributes:[{name:"Cor",value:"Marrom"}]});
 assert.ok(deterministic.some(item=>item.attribute==="color"&&item.value==="Marrom"));
 const output={suggestedName:"Adaptador",shortDescription:null,longDescription:null,bulletPoints:[],application:null,attributes:[{attribute:"connection",value:"Soldável",confidence:.9,status:"CANDIDATE",evidence:[{sourceType:"SOURCE_TITLE",sourceReference:"title",rawValue:"Soldável",normalizedValue:"Soldável",confidence:.9,extractionMethod:"deterministic"}],needsEvidence:false},{attribute:"color",value:"Marrom",confidence:.9,status:"CANDIDATE",evidence:[{sourceType:"SOURCE_ATTRIBUTE",sourceReference:"Cor",rawValue:"Marrom",normalizedValue:"Marrom",confidence:.9,extractionMethod:"structured_source"}],needsEvidence:false}],seo:{title:null,metaDescription:null,searchTerms:[]},uncertainties:[],evidenceReferences:[]};
 const result=reconcileEnrichmentOutput(deterministic,output);assert.deepEqual(result.unsupportedFacts,[]);assert.equal(result.attributes.find(item=>item.attribute==="connection")?.value,"soldável");assert.equal(result.attributes.find(item=>item.attribute==="color")?.value,"Marrom");
});

test("correções R1 bloqueiam falsos positivos alfanuméricos e preservam unidades reais",()=>{
 const candidates=new PimAttributeExtractor().extract({productId:"local",title:"Luminária 5W 6400K código 05602A Caixa 4x2 Verde",description:"Pesa 0,022kg e opera em 240V",brand:null,category:"Elétrica",sku:"",gtin:null,attributes:[]});
 assert.equal(candidates.some(item=>item.attribute==="current"),false);
 assert.equal(candidates.some(item=>item.attribute==="voltage"&&item.value.includes("2V")),false);
 assert.equal(candidates.some(item=>item.attribute==="color_temperature"&&item.value.includes("0,022K")),false);
 assert.ok(candidates.some(item=>item.attribute==="power"&&item.value==="5W"));
 assert.ok(candidates.some(item=>item.attribute==="color_temperature"&&item.value==="6400K"));
 assert.ok(candidates.some(item=>item.attribute==="voltage"&&item.value==="240V"));
});

test("extrator não cria conflito apenas por capitalização",()=>{
 const candidates=new PimAttributeExtractor().extract({productId:"local",title:"Conector Branco",description:"Produto branco",brand:null,category:null,sku:"",gtin:null,attributes:[{name:"Cor",value:"Branco"}]});
 const color=candidates.find(item=>item.attribute==="color");assert.equal(color?.status,"CANDIDATE");assert.equal(color?.value,"Branco");assert.deepEqual(color?.conflictingValues,[]);
});

test("material principal explícito não conflita com material de componente interno",()=>{
 const candidates=new PimAttributeExtractor().extract({productId:"local",title:"Conector de Porcelana",description:"Material: Porcelana de alta resistência térmica. Componentes Internos: túnel e parafuso em latão inoxidável.",brand:null,category:null,sku:"",gtin:null,attributes:[]});
 const material=candidates.find(item=>item.attribute==="material");assert.equal(material?.status,"CANDIDATE");assert.equal(material?.value,"porcelana");assert.deepEqual(material?.conflictingValues,[]);
});

test("reconciliação agrupa valores equivalentes sem diferenciar capitalização",()=>{
 const deterministic=new PimAttributeExtractor().extract({productId:"local",title:"Conector Branco",description:"Produto branco",brand:null,category:null,sku:"",gtin:null,attributes:[{name:"Cor",value:"Branco"}]});
 const output={suggestedName:"Conector Branco",shortDescription:null,longDescription:null,bulletPoints:[],application:null,attributes:[{attribute:"color",value:"Branco",confidence:.9,status:"CANDIDATE",evidence:[{sourceType:"SOURCE_ATTRIBUTE",sourceReference:"Cor",rawValue:"Branco",normalizedValue:"Branco",confidence:.9,extractionMethod:"structured_source"}],needsEvidence:false}],seo:{title:null,metaDescription:null,searchTerms:[]},uncertainties:[],evidenceReferences:[]};
 const result=reconcileEnrichmentOutput(deterministic,output);assert.deepEqual(result.blockingConflicts,[]);assert.deepEqual(result.unsupportedFacts,[]);assert.equal(result.acceptableForDraft,true);
});

test("tokens especiais C D E não viram atributos técnicos arbitrários",()=>{
 const extractor=new PimAttributeExtractor();
 const simple=extractor.extract({productId:"c",title:"Cesto Cromado Para Válvulas Astra",description:null,brand:"Astra",category:null,sku:"",gtin:null,attributes:[]});
 assert.deepEqual(simple.map(item=>item.attribute),["brand"]);assert.equal(simple.some(item=>item.attribute==="material"),false);
 const rich=extractor.extract({productId:"d",title:"Placa 2 Postos Afastados 4x2 Liz Branca - Tramontina",description:"Placa branca da linha Liz.",brand:"Tramontina",category:null,sku:"",gtin:null,attributes:[]});
 assert.equal(rich.some(item=>/4(?:mm|cm|\")\s*x\s*2/i.test(item.value)),false);assert.equal(rich.some(item=>item.attribute==="model"||item.value==="Liz"),false);
 const incomplete=extractor.extract({productId:"e",title:"Terminal Isolado Tubolar Simples Vermelho 10mm C12 20 Peças Sfor",description:null,brand:"Sfor",category:null,sku:"",gtin:null,attributes:[]});
 assert.ok(incomplete.some(item=>item.value==="10mm"));assert.equal(incomplete.some(item=>/C12|20\s*Peças/i.test(item.value)),false);
});
