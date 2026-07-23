"use client";

import { useState } from "react";
import { AccountDrawer } from "@/components/Account/AccountDrawer";
import { Button } from "@/components/UI/Button";

export function AccountPageAccess() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Entrar ou criar conta</Button>
      <AccountDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
