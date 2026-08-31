import Link from "next/link";

export function AccountPageAccess() {
  return (
    <Link
      href="/entrar"
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover"
    >
      Entrar na minha conta
    </Link>
  );
}
