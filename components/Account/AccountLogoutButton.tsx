"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/UI/Button";

export function AccountLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/account/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
    } finally {
      router.replace("/entrar");
      router.refresh();
    }
  }

  return (
    <Button variant="outline" onClick={logout} disabled={loading}>
      {loading ? "Saindo..." : "Sair"}
    </Button>
  );
}
