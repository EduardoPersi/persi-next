import {
  createRegionalGenerateMetadata,
  createRegionalGenerateStaticParams,
  createRegionalSegmentPage,
  type RegionalSegmentConfig,
} from "@/app/_storefront/regional-segment-page";

const config: RegionalSegmentConfig = {
  categorySlug: "eletrica",
  segmentLabel: "Materiais Elétricos",
  routeBase: "/materiais-eletricos",
  productSummary:
    "Fios e cabos, disjuntores e quadros, iluminação, eletrodutos, tomadas e interruptores e demais materiais elétricos para sua obra ou reforma.",
  featuredSubcategories: [
    { label: "Fios e Cabos", href: "/eletrica/fios-e-cabos" },
    { label: "Disjuntores e Quadros", href: "/eletrica/disjuntores-e-quadros" },
    { label: "Iluminação", href: "/eletrica/iluminacao" },
    {
      label: "Eletrodutos e Eletrocalhas",
      href: "/eletrica/eletrodutos-perfilados-e-eletrocalhas",
    },
    { label: "Tomadas e Interruptores", href: "/eletrica/tomadas-e-interruptores" },
  ],
};

export const generateStaticParams = createRegionalGenerateStaticParams();
export const generateMetadata = createRegionalGenerateMetadata(config);
export default createRegionalSegmentPage(config);
