import { signInWithFacebook, signInWithGoogle } from "@/lib/account/authActions";

type SocialLoginButtonsProps = {
  descriptionId: string;
  stacked?: boolean;
};

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4267a9"
        d="M13.7 22v-9.1h3.1l.5-3.6h-3.6V7c0-1 .3-1.8 1.8-1.8h1.9V2.1c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.8v2.6H6.8V13h3.1V22h3.8Z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 18 18"
      className="size-[18px]"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285f4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34a853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#fbbc05"
        d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96h-3A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z"
      />
      <path
        fill="#ea4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A8.67 8.67 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.17 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function SocialLoginButtons({
  descriptionId,
  stacked = false,
}: SocialLoginButtonsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium uppercase text-muted">
          Ou entre com
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className={`grid gap-3 ${stacked ? "" : "sm:grid-cols-2"}`}>
        <form className="contents" action={signInWithFacebook}>
          <button
            type="submit"
            className="relative inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#4267a9] px-3 text-sm font-medium uppercase !text-white !no-underline transition-colors hover:bg-[#365899] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-describedby={descriptionId}
          >
            <span
              aria-hidden="true"
              className="absolute left-2.5 flex size-7 items-center justify-center rounded bg-white"
            >
              <FacebookIcon />
            </span>
            Facebook
          </button>
        </form>

        <form className="contents" action={signInWithGoogle}>
          <button
            type="submit"
            className="relative inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#4285f4] px-3 text-sm font-medium uppercase !text-white !no-underline transition-colors hover:bg-[#3367d6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-describedby={descriptionId}
          >
            <span
              aria-hidden="true"
              className="absolute left-2.5 flex size-7 items-center justify-center rounded bg-white"
            >
              <GoogleIcon />
            </span>
            Google
          </button>
        </form>
      </div>
    </div>
  );
}
