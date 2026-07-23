"use client";

import { Button } from "@/components/UI/Button";

type SocialLoginButtonsProps = {
  descriptionId: string;
};

export function SocialLoginButtons({
  descriptionId,
}: SocialLoginButtonsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium uppercase text-slate-500">
          Ou entre com
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <Button
        variant="outline"
        className="w-full border-slate-300 text-slate-800"
        disabled
        aria-describedby={descriptionId}
      >
        <span aria-hidden="true" className="text-base font-semibold">
          G
        </span>
        Continuar com Google
      </Button>
      <Button
        variant="outline"
        className="w-full border-slate-300 text-slate-800"
        disabled
        aria-describedby={descriptionId}
      >
        <span aria-hidden="true" className="text-base font-semibold">
          f
        </span>
        Continuar com Facebook
      </Button>
    </div>
  );
}
