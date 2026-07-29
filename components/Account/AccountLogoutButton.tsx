"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/UI/Button";

export function AccountLogoutButton({
  variant = "default",
}: {
  variant?: "default" | "dashboard";
}) {
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

  if (variant === "dashboard") {
    return (
      <Button
        variant="outline"
        onClick={logout}
        disabled={loading}
        className="group min-h-36 w-full flex-col !border-slate-200 !bg-white p-5 !text-[#071f5c] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:!border-[#ff6a00]/60 hover:!bg-white hover:shadow-md focus-visible:ring-[#0c2d72]"
      >
        <LogOut
          className="size-12 stroke-[1.5] text-[#0c2d72] transition-colors group-hover:text-[#ff6a00]"
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
