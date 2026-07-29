import Link from "next/link";
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

      <Link
        href="/api/auth/google/start"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-describedby={descriptionId}
      >
        <span aria-hidden="true" className="text-base font-semibold">
          G
        </span>
        Entrar com Google
      </Link>
      <Button
        variant="outline"
        className="w-full border-slate-300 text-slate-800"
        disabled
        aria-describedby={descriptionId}
      >
        <span aria-hidden="true" className="text-base font-semibold">
          f
        </span>
        Entrar com Facebook — Em breve
      </Button>
    </div>
  );
}
