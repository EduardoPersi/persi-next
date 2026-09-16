// The single authoritative PIM v1 baseline this publication layer trusts
// today -- the canonical (generatedAt-excluded) payload hash of
// scratchpad/a35e_p2x_final_pim_v1_baseline.json, confirmed in A3.5E-P2-X
// and re-verified in A3.5E-P3-A/P3-B. A publishBatch() call must carry this
// exact reference; anything else (missing, stale, or simply wrong) is
// rejected before any eligibility check or write runs, per A3.5E-P3-B
// Section 16 ("baseline/stale authorization").
//
// This is a single hardcoded value, not a live lookup, on purpose: the PIM
// v1 baseline is a POINT-IN-TIME artifact frozen at the close of A3.5E-P2 --
// it changes only when a new phase formally re-baselines the catalog (a
// deliberate, rare, human-authored event), never as a side effect of
// ordinary reads or writes. Bumping it is a one-line, reviewable change.
export const CURRENT_PIM_BASELINE_SHA256 = "4b4cb3da092ebea4837850249f82c56543e0fac42c11b680ec315a26d462399d";
