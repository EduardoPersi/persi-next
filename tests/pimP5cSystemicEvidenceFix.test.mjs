import test from "node:test";
import assert from "node:assert/strict";
import {auditCompactEvidenceBindings,buildPimEvidenceCatalog,classifyEvidenceValue,rebindCompactEvidence,resolveCompactEvidence} from "../lib/pim/evidence-catalog.ts";
import {PimAttributeExtractor} from "../lib/pim/extractor.ts";
import {normalizeMeasurement} from "../lib/pim/normalization.ts";

const evidence=(attribute,value,reference="p1")=>({attribute,value,rawValue:value,unit:null,confidence:1,confidenceBand:"HIGH",status:"CANDIDATE",conflictingValues:[],evidence:[{sourceType:"SOURCE_ATTRIBUTE",sourceReference:reference,rawValue:value,normalizedValue:value,confidence:1,extractionMethod:"deterministic"}]});
const output=(attribute,value,ref="e1")=>({suggestedName:null,shortDescription:null,longDescription:null,bulletPoints:[],application:null,attributes:[{attribute,value,evidenceRefs:[ref]}],seo:{title:null,metaDescription:null,searchTerms:[]},uncertainties:[]});
const catalog=(items,product="p1")=>buildPimEvidenceCatalog(items,{productReference:product});
const blocked=(candidate,cat,product="p1")=>auditCompactEvidenceBindings(candidate,cat,{expectedProductReference:product}).length>0;

test("P5-C-FIX matriz adversarial de ownership e valores",()=>{
 const exact=catalog([evidence("diameter","25mm")]);
 assert.equal(blocked(output("diameter","25mm"),exact),false); // 1
 assert.equal(blocked(output("material","25mm"),exact),true); // 2
 assert.equal(blocked(output("diameter","25mm"),exact,"p2"),true); // 3
 assert.equal(classifyEvidenceValue("25 mm","25mm"),"CANONICAL_EQUIVALENCE"); // 4
 assert.equal(classifyEvidenceValue('25mm x 1/2 pol.','25 mm x 1/2"'),"COMPOUND_REPRESENTATION"); // 5
 assert.equal(blocked(output("diameter","25mm"),catalog([evidence("diameter",'25mm x 1/2"')])),true); // 6
 assert.equal(resolveCompactEvidence(output("diameter","25"),exact).attributes[0].value,"25mm"); // 7
 const ambiguous=catalog([evidence("diameter","25mm"),evidence("diameter","25cm")]);
 assert.throws(()=>resolveCompactEvidence({...output("diameter","25"),attributes:[{attribute:"diameter",value:"25",evidenceRefs:["e1","e2"]}]},ambiguous),/AMBIGUOUS/); // 8
 assert.equal(classifyEvidenceValue("2.5cm","25mm"),"UNSUPPORTED_VALUE"); // 9: no conversion policy
 assert.equal(classifyEvidenceValue("100-240V","240V"),"EXPANSION"); // 10
 assert.equal(classifyEvidenceValue("240V","100-240V"),"NARROWING"); // 11
 assert.equal(blocked(output("voltage","240V"),catalog([evidence("category","Elétrica")])),true); // 12
 assert.equal(blocked(output("material","PVC"),catalog([evidence("brand","Krona")])),true); // 13
 assert.equal(blocked(output("material","PVC"),catalog([evidence("color","PVC")])),true); // 14
 assert.equal(blocked(output("voltage","127V"),catalog([evidence("voltage","127V/220V")])),true); // 15
 assert.equal(blocked(output("diameter","32mm"),exact),true); // 16
 assert.equal(blocked(output("diameter","25mm","e2"),exact),true); // 17
 assert.equal(blocked(output("voltage","220V"),catalog([evidence("voltage","não confirmado: 220V")])),true); // 18
 const conflict=catalog([{...evidence("voltage","127V"),status:"CONFLICT",evidence:[...evidence("voltage","127V").evidence,...evidence("voltage","220V").evidence]}]);
 assert.equal(blocked(output("voltage","127V"),conflict),true); // 19
 assert.equal(blocked(output("voltage","380V"),catalog([evidence("voltage","127V"),evidence("voltage","220V")])),true); // 20
});

test("ownership rebound exige exatamente uma evidence compativel",()=>{
 const unique=catalog([evidence("diameter","20mm"),evidence("length","20mm")]);
 const wrong=output("length","20mm","e1"),rebound=rebindCompactEvidence(wrong,unique);
 assert.equal(rebound.audits.length,1);
 assert.equal(rebound.audits[0].decision,"MODEL_EVIDENCE_REF_REJECTED_DETERMINISTIC_EVIDENCE_REBOUND");
 assert.equal(resolveCompactEvidence(wrong,unique).attributes[0].value,"20mm");
 const ambiguous=catalog([evidence("diameter","20mm"),evidence("length","20mm","a"),evidence("length","20mm","b")]);
 assert.throws(()=>resolveCompactEvidence(wrong,ambiguous),/FOREIGN_EVIDENCE_REF/);
 assert.throws(()=>resolveCompactEvidence(output("length","30mm","e2"),unique),/SEMANTIC_EVIDENCE_MISMATCH/);
});

test("P5-C-FIX preserva palavras iniciadas em pol e atribui metro a comprimento",()=>{
 assert.equal(normalizeMeasurement("Polietileno"),"Polietileno");
 assert.equal(normalizeMeasurement("3/8 pol."),'3/8"');
 const extracted=new PimAttributeExtractor().extract({productId:"p",title:'Tubo PVC 1/2" 6M',description:null,brand:null,category:null,sku:"",gtin:null,attributes:[]});
 assert.equal(extracted.find(item=>item.attribute==="length")?.value,"6M");
 assert.equal(extracted.find(item=>item.attribute==="diameter")?.evidence.some(item=>item.normalizedValue==="6M")??false,false);
});
