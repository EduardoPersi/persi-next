"use server";
import { revalidatePath } from "next/cache";
import { requirePimAdmin } from "@/lib/pim/authorization";
import { decidePimSuggestion, PimConcurrencyError, savePimEditorialDraft, transitionPimEditorial, type PimDecision } from "@/lib/pim/workflow";

export type PimActionState={ok:boolean;error?:string};
const actor=(id:string|number)=>`wp:${id}`;
const list=(value:FormDataEntryValue|null)=>String(value??"").split(/\r?\n/).map(item=>item.trim()).filter(Boolean);

export async function saveEditorialDraft(_state:PimActionState,formData:FormData):Promise<PimActionState>{
  const user=await requirePimAdmin();
  try{
    const productId=String(formData.get("productId")??"");
    await savePimEditorialDraft({
      productId,version:BigInt(String(formData.get("version")??"0")),
      commercialName:String(formData.get("commercialName")??""),shortDescription:String(formData.get("shortDescription")??""),
      description:String(formData.get("description")??""),bulletPoints:list(formData.get("bulletPoints")),
      application:String(formData.get("application")??""),specifications:String(formData.get("specifications")??""),
      seoTitle:String(formData.get("seoTitle")??""),metaDescription:String(formData.get("metaDescription")??""),
      searchTerms:list(formData.get("searchTerms")),imageAltText:String(formData.get("imageAltText")??""),
    },actor(user.id));
    revalidatePath(`/admin/products/${productId}`);revalidatePath("/admin/products");revalidatePath("/admin/pim");
    return {ok:true};
  }catch(error){return {ok:false,error:error instanceof PimConcurrencyError?error.message:error instanceof Error?error.message:"Não foi possível salvar o rascunho."};}
}

export async function runEditorialWorkflow(_state:PimActionState,formData:FormData):Promise<PimActionState>{
  const user=await requirePimAdmin();
  try{
    const productId=String(formData.get("productId")??"");
    await transitionPimEditorial({productId,version:BigInt(String(formData.get("version")??"0")),action:String(formData.get("action")??"") as "SUBMIT_REVIEW",reason:String(formData.get("reason")??"")||undefined},actor(user.id));
    revalidatePath(`/admin/products/${productId}`);revalidatePath("/admin/products");revalidatePath("/admin/pim");
    return {ok:true};
  }catch(error){return {ok:false,error:error instanceof PimConcurrencyError?error.message:error instanceof Error?error.message:"Não foi possível executar a ação."};}
}

export async function reviewSuggestion(formData:FormData){
  const user=await requirePimAdmin(); const suggestionId=String(formData.get("suggestionId")??""); const decision=String(formData.get("decision")??"") as PimDecision;
  if(decision!=="approved"&&decision!=="rejected")throw new Error("Decisão inválida.");
  const result=await decidePimSuggestion({suggestionId,decision,actorReference:actor(user.id)});
  revalidatePath(`/admin/products/${result.productId}`); revalidatePath("/admin/products"); revalidatePath("/admin/pim");
}
