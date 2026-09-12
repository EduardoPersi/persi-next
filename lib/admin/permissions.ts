export const ADMIN_ROLES=["ADMIN","PIM_REVIEWER","PIM_APPROVER"] as const;
export type AdminRole=(typeof ADMIN_ROLES)[number];
export const ADMIN_PERMISSIONS=["pim.admin.read","pim.draft.edit","pim.workflow.submit","pim.workflow.approve","pim.workflow.reject","pim.workflow.reopen","pim.workflow.discard","pim.suggestion.review","pim.suggestion.extract_deterministic"] as const;
export type AdminPermission=(typeof ADMIN_PERMISSIONS)[number];
const MATRIX:Readonly<Record<AdminRole,ReadonlySet<AdminPermission>>>={
 ADMIN:new Set(ADMIN_PERMISSIONS),
 PIM_REVIEWER:new Set(["pim.admin.read","pim.draft.edit","pim.workflow.submit","pim.workflow.reopen","pim.workflow.discard","pim.suggestion.review","pim.suggestion.extract_deterministic"]),
 PIM_APPROVER:new Set(["pim.admin.read","pim.workflow.approve","pim.workflow.reject"]),
};
export function isAdminRole(value:string):value is AdminRole{return (ADMIN_ROLES as readonly string[]).includes(value)}
export function roleHasPermission(role:string,permission:string):boolean{return isAdminRole(role)&&(ADMIN_PERMISSIONS as readonly string[]).includes(permission)&&MATRIX[role].has(permission as AdminPermission)}
export const WORKFLOW_PERMISSION={SUBMIT_REVIEW:"pim.workflow.submit",APPROVE:"pim.workflow.approve",REJECT:"pim.workflow.reject",REOPEN:"pim.workflow.reopen",DISCARD_DRAFT:"pim.workflow.discard"} as const satisfies Record<string,AdminPermission>;
export function permissionForWorkflowAction(action:string):AdminPermission|null{return WORKFLOW_PERMISSION[action as keyof typeof WORKFLOW_PERMISSION]??null}
