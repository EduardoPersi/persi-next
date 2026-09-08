export type PimBatchFailureClass=
 |"PRODUCT_LOCAL"
 |"QUALITY_LOCAL"
 |"SOURCE_LOCAL"
 |"MODEL_LOCAL_CONTAINED_FAILURE"
 |"SYSTEMIC_PIPELINE_FAILURE"
 |"OTHER";

export type PimBatchAction="PASS"|"PRODUCT_QUARANTINE_CONTINUE"|"QUALITY_DEGRADATION_STOP"|"HARD_STOP"|"SAFE_ABORT";

export type PimBatchSignal=
 |"PASS"
 |"FOREIGN_EVIDENCE_REF_BLOCKED"
 |"FOREIGN_EVIDENCE_REF_REBOUNDED"
 |"FOREIGN_EVIDENCE_ACCEPTED"
 |"CROSS_PRODUCT_EVIDENCE"
 |"CATALOG_WRONG_OWNERSHIP"
 |"RESOLVER_ACCEPTED_INCOMPATIBLE_EVIDENCE"
 |"VALIDATOR_MISSED_FOREIGN_EVIDENCE"
 |"AMBIGUOUS_REBOUND_ACCEPTED"
 |"UNSUPPORTED_EXPANSION_BLOCKED"
 |"UNSUPPORTED_EXPANSION_ACCEPTED"
 |"QUALITY_EDITORIAL_FAILURE"
 |"SOURCE_INCOMPLETE"
 |"DLP_FAILURE"
 |"UNEXPECTED_STAGING_WRITE"
 |"MARKER_CORRUPTION"
 |"PROVIDER_INDETERMINATE";

export type PimBatchDecision={classification:PimBatchFailureClass;action:PimBatchAction;safetySystemWorked:boolean};

const decisions:Record<PimBatchSignal,PimBatchDecision>={
 PASS:{classification:"OTHER",action:"PASS",safetySystemWorked:true},
 FOREIGN_EVIDENCE_REF_BLOCKED:{classification:"MODEL_LOCAL_CONTAINED_FAILURE",action:"PRODUCT_QUARANTINE_CONTINUE",safetySystemWorked:true},
 FOREIGN_EVIDENCE_REF_REBOUNDED:{classification:"OTHER",action:"PASS",safetySystemWorked:true},
 FOREIGN_EVIDENCE_ACCEPTED:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 CROSS_PRODUCT_EVIDENCE:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 CATALOG_WRONG_OWNERSHIP:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 RESOLVER_ACCEPTED_INCOMPATIBLE_EVIDENCE:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 VALIDATOR_MISSED_FOREIGN_EVIDENCE:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 AMBIGUOUS_REBOUND_ACCEPTED:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 UNSUPPORTED_EXPANSION_BLOCKED:{classification:"PRODUCT_LOCAL",action:"PRODUCT_QUARANTINE_CONTINUE",safetySystemWorked:true},
 UNSUPPORTED_EXPANSION_ACCEPTED:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 QUALITY_EDITORIAL_FAILURE:{classification:"QUALITY_LOCAL",action:"PRODUCT_QUARANTINE_CONTINUE",safetySystemWorked:true},
 SOURCE_INCOMPLETE:{classification:"SOURCE_LOCAL",action:"PRODUCT_QUARANTINE_CONTINUE",safetySystemWorked:true},
 DLP_FAILURE:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 UNEXPECTED_STAGING_WRITE:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 MARKER_CORRUPTION:{classification:"SYSTEMIC_PIPELINE_FAILURE",action:"HARD_STOP",safetySystemWorked:false},
 PROVIDER_INDETERMINATE:{classification:"OTHER",action:"SAFE_ABORT",safetySystemWorked:true},
};

export const PIM_QUALITY_DEGRADATION_POLICY={
 minimumObservations:20,
 minimumModelContractViolations:4,
 modelContractViolationRateThreshold:0.16,
 historicalBasis:{attempted:43,modelContractViolations:4,containedWithoutRebound:2},
 rationale:"The 16% threshold is the rounded 95% Wilson upper bound for 2 contained failures in 43 attempts; four violations and 20 observations prevent a tiny sample from stopping a batch.",
} as const;

export function classifyPimBatchSignal(signal:PimBatchSignal):PimBatchDecision{return decisions[signal];}

export function evaluatePimQualityDegradation(observations:number,modelContractViolations:number):PimBatchAction{
 if(observations<PIM_QUALITY_DEGRADATION_POLICY.minimumObservations||modelContractViolations<PIM_QUALITY_DEGRADATION_POLICY.minimumModelContractViolations)return"PASS";
 return modelContractViolations/observations>PIM_QUALITY_DEGRADATION_POLICY.modelContractViolationRateThreshold?"QUALITY_DEGRADATION_STOP":"PASS";
}

export function classifyContainedValidationFailure(reason:string):PimBatchSignal|null{
 if(reason.startsWith("FOREIGN_EVIDENCE_REF:SAME_PRODUCT_SEMANTICALLY_FOREIGN_REF:"))return"FOREIGN_EVIDENCE_REF_BLOCKED";
 if(reason.includes("UNSUPPORTED_VALUE_EXPANSION")||reason.startsWith("SEMANTIC_EVIDENCE_MISMATCH:UNSUPPORTED_EVIDENCE_VALUE:"))return"UNSUPPORTED_EXPANSION_BLOCKED";
 return null;
}
