import Link from "next/link";

export function AccountPageAccess() {
  return (
    <Link
      href="/entrar"
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0c2d72] px-4 py-2 font-medium text-white hover:bg-[#071f5c]"
    >
      Entrar na minha conta
    </Link>
  );
}
