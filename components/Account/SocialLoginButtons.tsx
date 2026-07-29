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

      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          className="relative w-full bg-[#4267a9] px-3 text-sm uppercase hover:bg-[#365899] disabled:opacity-70"
          disabled
          aria-describedby={descriptionId}
        >
          <span
            aria-hidden="true"
            className="absolute left-2.5 flex size-7 items-end justify-center rounded-sm bg-white text-xl font-bold leading-none text-[#4267a9]"
          >
            f
          </span>
          Facebook <span className="sr-only">— Em breve</span>
        </Button>

        <Link
          href="/api/auth/google/start"
          className="relative inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#4285f4] px-3 text-sm font-medium uppercase text-white transition-colors hover:bg-[#3367d6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-describedby={descriptionId}
        >
          <span
            aria-hidden="true"
            className="absolute left-2.5 flex size-7 items-center justify-center rounded-sm bg-white text-base font-bold normal-case text-[#4285f4]"
          >
            G
          </span>
          Google
        </Link>
      </div>
    </div>
  );
}
