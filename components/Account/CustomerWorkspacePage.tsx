import type { ReactNode } from "react";
import type { AccountSession } from "@/lib/account/validation";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import { CustomerWorkspaceShell } from "./CustomerWorkspaceShell";

export function CustomerWorkspacePage({
  title,
  session,
  children,
}: {
  title: string;
  session: AccountSession;
  children: ReactNode;
}) {
  const name = session.customer.firstName || session.customer.displayName || "Cliente";
  return (
    <InstitutionalPageLayout title={title} accountSession={session} containerSize="lg">
      <CustomerWorkspaceShell customerName={name} customerEmail={session.customer.email}>
        {children}
      </CustomerWorkspaceShell>
    </InstitutionalPageLayout>
  );
}
