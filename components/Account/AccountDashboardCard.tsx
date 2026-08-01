import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type AccountDashboardCardProps = {
  href: string;
  icon: LucideIcon;
  title: string;
};

const cardClassName =
  "group flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm transition duration-200";

export function AccountDashboardCard({
  href,
  icon: Icon,
  title,
}: AccountDashboardCardProps) {
  const content = (
    <>
      <Icon
        className="size-12 stroke-[1.5] text-[#0c2d72] transition-colors group-hover:text-[#ff6a00]"
        aria-hidden="true"
      />
      <span className="mt-4 font-semibold text-[#071f5c]">{title}</span>
    </>
  );

  return (
    <Link
      href={href}
      className={`${cardClassName} !text-[#071f5c] !no-underline hover:-translate-y-0.5 hover:border-[#ff6a00]/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2`}
    >
      {content}
    </Link>
  );
}
