import {
  createRegionalGenerateMetadata,
  createRegionalGenerateStaticParams,
  createRegionalSegmentPage,
  type RegionalSegmentConfig,
} from "@/app/_storefront/regional-segment-page";

const config: RegionalSegmentConfig = {
  categorySlug: "hidraulica",
  segmentLabel: "Materiais Hidráulicos",
  routeBase: "/materiais-hidraulicos",
  productSummary:
    "Tubos e conexões PVC/PEX, caixas d'água, bombas para poço artesiano, válvulas e registros e demais materiais hidráulicos para sua obra ou reforma.",
  featuredSubcategories: [
    { label: "Tubos e Conexões", href: "/hidraulica/tubos-e-conexoes" },
    { label: "Caixas D'Água", href: "/hidraulica/caixas-d-agua" },
    {
      label: "Bombas e Poço Artesiano",
      href: "/hidraulica/bombas-e-paineis-poco-artesiano",
    },
    { label: "Válvulas e Registros", href: "/hidraulica/valvulas-registros" },
    { label: "PEX", href: "/hidraulica/pex" },
  ],
};

export const generateStaticParams = createRegionalGenerateStaticParams();
export const generateMetadata = createRegionalGenerateMetadata(config);
export default createRegionalSegmentPage(config);
