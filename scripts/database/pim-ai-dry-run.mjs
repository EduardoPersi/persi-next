if(process.argv.slice(2).length!==1||process.argv[2]!=="--synthetic")throw new Error("O harness P.3C aceita exclusivamente --synthetic para um produto.");
process.loadEnvFile?.(".env.local");
const {preparePimAiDryRun}=await import("../../lib/pim/ai-dry-run.ts");
const product={productId:"00000000-0000-4000-8000-000000000001",name:'Luva de Redução Soldável com Rosca 25mm x 1/2" Tigre',description:'Conexão hidráulica para transição entre trecho soldável de 25mm e conexão roscável de 1/2".',sku:"P3C-SYNTHETIC-NOT-SENT",gtin:null,brand:"Tigre",category:"Conexões Hidráulicas",attributes:[{name:"bitola",value:'25mm x 1/2"'},{name:"connection",value:"soldável + rosca"}]};
const result=preparePimAiDryRun(product);
console.log(JSON.stringify({...result,productCount:1,synthetic:true,gtinSent:"gtin" in result.safeContext,skuSent:"sku" in result.safeContext,realAiCalls:0},(_,value)=>typeof value==="bigint"?value.toString():value,2));
