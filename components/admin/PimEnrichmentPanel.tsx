import type {PimEditorialContent,PimSuggestionItem} from "@/lib/pim/repository";

type ProviderStatus={enabled:boolean;provider:string;model:string|null;configured:boolean;state:"disabled"|"not_configured"|"ready"};
type Props={productId:string;sourceName:string;draft:PimEditorialContent;suggestions:PimSuggestionItem[];providerStatus:ProviderStatus;extractAction:(formData:FormData)=>Promise<void>};
const label=(value:string)=>value.replace("attribute_","").replaceAll("_"," ");
const statusLabel=(status:ProviderStatus)=>status.state==="disabled"?"IA desabilitada":status.state==="not_configured"?"IA não configurada":"Pronto para teste controlado";

export function PimEnrichmentPanel({productId,sourceName,draft,suggestions,providerStatus,extractAction}:Props){
 return <section id="ai-enrichment" className="mt-6 rounded-xl border bg-white p-5">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><h2 className="text-lg font-bold text-[#071f5c]">AI / Enrichment</h2><p className="mt-1 text-sm text-slate-600">Extração determinística, evidências e revisão humana. Nunca há aprovação ou publicação automática.</p><p className="mt-2 text-xs font-semibold uppercase text-slate-500">{statusLabel(providerStatus)} · {providerStatus.provider}{providerStatus.model?` / ${providerStatus.model}`:""}</p></div>
   <div className="flex flex-wrap gap-2"><form action={extractAction}><input type="hidden" name="productId" value={productId}/><button className="rounded-xl bg-[#0c2d72] px-4 py-2 text-sm font-semibold text-white">Extrair sugestões</button></form><button disabled title="Chamadas reais permanecem bloqueadas na P.3B" className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-400">Gerar sugestões com IA</button></div>
  </div>
  <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Uma execução futura exigirá confirmação explícita do produto, provider, modelo e escopo. Credenciais nunca são exibidas nesta tela.</p>
  <div className="mt-5 space-y-3">{suggestions.map(s=><article key={s.id} className={`rounded-xl border p-4 ${s.supersededAt?"opacity-60":""}`}>
   <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold capitalize">{label(s.fieldName)}</h3><span className="text-xs uppercase text-slate-500">{s.status} · {s.provider}/{s.modelVersion} · {s.confidence??"—"}</span></div>
   <div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-slate-500">Current</p><p className="mt-1 text-sm">{["commercialName","commercial_name"].includes(s.fieldName)?(draft.commercialName??sourceName):"—"}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Suggested</p><p className="mt-1 text-sm">{s.value}</p></div></div>
   <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2"><div><dt className="font-semibold uppercase">Provider / modelo</dt><dd>{s.provider} / {s.modelVersion}</dd></div><div><dt className="font-semibold uppercase">Prompt</dt><dd>{s.promptVersion}</dd></div><div><dt className="font-semibold uppercase">Source fingerprint</dt><dd className="break-all font-mono">{s.sourceFingerprint}</dd></div><div><dt className="font-semibold uppercase">Criada em</dt><dd>{new Date(s.createdAt).toLocaleString("pt-BR")}</dd></div></dl>
   {s.payload.reconciliationType==="MODEL_RETURNED_INCOMPLETE_VALUE_RECONCILED_FROM_SOURCE"&&<div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-950"><p className="font-semibold">Valor reconciliado com a fonte</p><p>Valor sugerido bruto: {String(s.payload.rawModelValue??"—")}</p><p>Valor canônico: {String(s.payload.canonicalSourceValue??"—")}</p></div>}
   {s.evidenceReferences.length>0&&<div className="mt-3"><p className="text-xs font-semibold uppercase text-slate-500">Evidence</p><ul className="mt-1 list-disc pl-5 text-sm">{s.evidenceReferences.map((e,index)=><li key={`${s.id}-${index}`}>{e.sourceType??"SOURCE"}: {e.rawValue??e.value??"—"}</li>)}</ul></div>}
   {s.payload.status==="CONFLICT"&&<div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900"><p>CONFLICT — exige revisão; nenhuma opção foi escolhida automaticamente.</p>{Array.isArray(s.payload.conflictCandidates)&&<ul className="mt-2 list-disc pl-5">{s.payload.conflictCandidates.map((candidate,index)=><li key={`${s.id}-conflict-${index}`}>{typeof candidate==="object"&&candidate&&"value" in candidate?String(candidate.value):"Candidato inválido"}</li>)}</ul>}</div>}
  </article>)}{suggestions.length===0&&<p className="text-sm text-slate-500">Nenhuma sugestão gerada.</p>}</div>
 </section>;
}
