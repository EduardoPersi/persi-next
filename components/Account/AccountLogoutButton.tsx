"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { useAccount } from "@/hooks/useAccount";

export function AccountLogoutButton({
  variant = "default",
}: {
  variant?: "default" | "dashboard";
}) {
  const { logout: endSession } = useAccount();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    await endSession();
  }

  if (variant === "dashboard") {
    return (
      <Button
        variant="outline"
        onClick={logout}
        disabled={loading}
        className="group min-h-36 w-full flex-col !border-slate-200 !bg-white p-5 !text-primary-hover shadow-sm transition duration-200 hover:-translate-y-0.5 hover:!border-secondary/60 hover:!bg-white hover:shadow-md focus-visible:ring-primary"
      >
        <LogOut
          className="size-12 stroke-[1.5] text-primary transition-colors group-hover:text-secondary"
          aria-hidden="true"
        />
        <span className="mt-2 font-semibold">
          {loading ? "Saindo..." : "Sair"}
        </span>
      </Button>
    );
  }

  return (
    <Button variant="outline" onClick={logout} disabled={loading}>
      {loading ? "Saindo..." : "Sair"}
    </Button>
  );
}
