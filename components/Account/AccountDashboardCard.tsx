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
        className="size-12 stroke-[1.5] text-primary transition-colors group-hover:text-secondary"
        aria-hidden="true"
      />
      <span className="mt-4 font-semibold text-primary-hover">{title}</span>
    </>
  );

  return (
    <Link
      href={href}
      className={`${cardClassName} !text-primary-hover !no-underline hover:-translate-y-0.5 hover:border-secondary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`}
    >
      {content}
    </Link>
  );
}
