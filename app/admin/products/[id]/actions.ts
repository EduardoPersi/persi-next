"use server";
import { revalidatePath } from "next/cache";
import { requirePimAdmin } from "@/lib/pim/authorization";
import { decidePimSuggestion, type PimDecision } from "@/lib/pim/workflow";

export async function reviewSuggestion(formData:FormData){
  const user=await requirePimAdmin(); const suggestionId=String(formData.get("suggestionId")??""); const decision=String(formData.get("decision")??"") as PimDecision;
  if(decision!=="approved"&&decision!=="rejected")throw new Error("Decisão inválida.");
  const result=await decidePimSuggestion({suggestionId,decision,actorReference:`wp:${user.id}`});
  revalidatePath(`/admin/products/${result.productId}`); revalidatePath("/admin/products"); revalidatePath("/admin/pim");
}
