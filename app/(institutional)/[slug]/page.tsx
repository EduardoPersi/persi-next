import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InstitutionalPageLayout } from "@/components/Institutional/InstitutionalPageLayout";
import {
  institutionalPageMap,
  isInstitutionalRouteSlug,
} from "@/lib/constants/institutionalPages";
import { getWordPressPageBySlug } from "@/services/wordpress/pages";

type InstitutionalPageProps = {
  params: Promise<{ slug: string }>;
};

export const revalidate = 3600;

export function generateStaticParams() {
  return Object.keys(institutionalPageMap).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: InstitutionalPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isInstitutionalRouteSlug(slug)) return {};

  const config = institutionalPageMap[slug];
  const description = `Consulte ${config.title.toLocaleLowerCase("pt-BR")} da Persi Materiais de Construção.`;

  return {
    title: `${config.title} | Persi Materiais de Construção`,
    description,
    alternates: { canonical: `/${slug}` },
    openGraph: {
      title: `${config.title} | Persi Materiais de Construção`,
      description,
      type: "article",
    },
  };
}

export default async function InstitutionalPage({
  params,
}: InstitutionalPageProps) {
  const { slug } = await params;
  if (!isInstitutionalRouteSlug(slug)) notFound();

  const config = institutionalPageMap[slug];
  const page = await getWordPressPageBySlug(config.wordpressSlug);
  if (!page) notFound();

  return (
    <InstitutionalPageLayout title={config.title} modified={page.modified}>
      <div dangerouslySetInnerHTML={{ __html: page.content }} />
    </InstitutionalPageLayout>
  );
}
