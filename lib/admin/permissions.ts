export const ADMIN_ROLES=["ADMIN","PIM_REVIEWER","PIM_APPROVER"] as const;
export type AdminRole=(typeof ADMIN_ROLES)[number];
export const ADMIN_PERMISSIONS=["pim.admin.read","pim.draft.edit","pim.workflow.submit","pim.workflow.approve","pim.workflow.reject","pim.workflow.reopen","pim.workflow.discard","pim.suggestion.review","pim.suggestion.extract_deterministic","pim.conflict.resolve","pim.attribute.review"] as const;
export type AdminPermission=(typeof ADMIN_PERMISSIONS)[number];
const MATRIX:Readonly<Record<AdminRole,ReadonlySet<AdminPermission>>>={
 ADMIN:new Set(ADMIN_PERMISSIONS),
 PIM_REVIEWER:new Set(["pim.admin.read","pim.draft.edit","pim.workflow.submit","pim.workflow.reopen","pim.workflow.discard","pim.suggestion.review","pim.suggestion.extract_deterministic","pim.attribute.review"]),
 // A3.7-FINAL-A: PIM_APPROVER previously could approve/reject the
 // editorial workflow and resolve conflicts, but could NOT record an
 // attribute review decision (pim.attribute.review) -- the exact
 // permission the human-approval-before-publication policy now requires
 // an approver to exercise. Added explicitly, least-privilege: no other
 // permission is granted alongside it, and PIM_REVIEWER's own existing
 // set is untouched.
 PIM_APPROVER:new Set(["pim.admin.read","pim.workflow.approve","pim.workflow.reject","pim.conflict.resolve","pim.attribute.review"]),
};
export function isAdminRole(value:string):value is AdminRole{return (ADMIN_ROLES as readonly string[]).includes(value)}
export function roleHasPermission(role:string,permission:string):boolean{return isAdminRole(role)&&(ADMIN_PERMISSIONS as readonly string[]).includes(permission)&&MATRIX[role].has(permission as AdminPermission)}
export const WORKFLOW_PERMISSION={SUBMIT_REVIEW:"pim.workflow.submit",APPROVE:"pim.workflow.approve",REJECT:"pim.workflow.reject",REOPEN:"pim.workflow.reopen",DISCARD_DRAFT:"pim.workflow.discard"} as const satisfies Record<string,AdminPermission>;
export function permissionForWorkflowAction(action:string):AdminPermission|null{return WORKFLOW_PERMISSION[action as keyof typeof WORKFLOW_PERMISSION]??null}
