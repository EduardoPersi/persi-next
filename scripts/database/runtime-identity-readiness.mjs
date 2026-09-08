export class SemanticReadiness {
  constructor(requiredSuccesses = 3) { this.requiredSuccesses=requiredSuccesses; this.consecutive=0; this.attempts=0; this.regressions=0; }
  observe(success) { this.attempts++; if(success) this.consecutive++; else { if(this.consecutive>0)this.regressions++; this.consecutive=0; } return this.consecutive>=this.requiredSuccesses; }
}
export function semanticProbePassed({ initComplete, databaseReady }) { return initComplete === true && databaseReady === true; }
export async function waitForSemanticReadiness({ probe, timeoutMs=90000, pollMs=500, requiredSuccesses=3, now=()=>Date.now(), pause=ms=>new Promise(r=>setTimeout(r,ms)) }) {
  const tracker=new SemanticReadiness(requiredSuccesses),started=now();
  while(now()-started<timeoutMs){ const ready=tracker.observe(await probe()); if(ready)return{...tracker,durationMs:now()-started}; await pause(pollMs); }
  const error=new Error("R4_A_SUPABASE_BOOTSTRAP_TIMEOUT"); error.safeDiagnostics={attempts:tracker.attempts,regressions:tracker.regressions,consecutive:tracker.consecutive}; throw error;
}
export function redactDiagnostic(value, secrets=[]) { let output=String(value); for(const secret of secrets)if(secret)output=output.split(secret).join("[REDACTED]"); return output.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi,"postgresql://[REDACTED]@"); }
