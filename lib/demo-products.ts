import type { Product } from "@/types/product";

const productImages = [
  {
    src: "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp",
    alt: "Torneira para cozinha de parede cromada - vista principal demonstrativa",
  },
  {
    src: "/images/footer/newsletter.webp",
    alt: "Torneira para cozinha de parede cromada - detalhe demonstrativo",
  },
  {
    src: "/images/footer/transportadoras.webp",
    alt: "Torneira para cozinha de parede cromada - embalagem demonstrativa",
  },
];

const baseProduct: Product = {
  id: 1,
  slug: "torneira-para-cozinha-de-parede-cromada",
  name: "Torneira para Cozinha de Parede Cromada",
  permalink:
    "/produto/torneira-para-cozinha-de-parede-cromada",
  sku: "TOR-COZ-001",
  brand: "Persi",
  shortDescription:
    "Torneira cromada para instalação na parede, indicada para cozinhas e áreas de serviço.",
  description:
    "A Torneira para Cozinha de Parede Cromada combina acabamento de fácil limpeza com instalação prática na parede. É uma opção demonstrativa para cozinhas e áreas de serviço que precisam de funcionalidade e visual discreto.",
  price: 89.9,
  regularPrice: 99.9,
  salePrice: 89.9,
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
  pixPrice: 80.91,
  installmentText: "Até 3x de R$ 29,97 sem juros",
  available: true,
  stockStatus: "in-stock",
  stockQuantity: 12,
  image: productImages[0],
  images: productImages,
  categories: [
    {
      id: 177,
      name: "Hidráulica",
      slug: "hidraulica",
      description: "",
      parent: 0,
    },
    {
      id: 1,
      name: "Torneiras",
      slug: "torneiras",
      description: "",
      parent: 177,
    },
  ],
  brands: [{ id: 1, name: "Persi", slug: "persi" }],
  averageRating: 0,
  reviewCount: 0,
  featured: false,
  onSale: true,
  attributes: [],
  specifications: [
    { label: "Material", value: "Metal" },
    { label: "Acabamento", value: "Cromado" },
    { label: "Instalação", value: "Parede" },
    { label: "Uso indicado", value: "Cozinha e área de serviço" },
    { label: "Garantia", value: "12 meses" },
  ],
  variations: [
    {
      id: "acabamento",
      name: "Acabamento",
      options: ["Cromado"],
    },
  ],
};

const relatedProducts: Product[] = [
  {
    ...baseProduct,
    id: 2,
    slug: "torneira-para-cozinha",
    name: "Torneira para Cozinha de Mesa",
    sku: "TOR-COZ-002",
    price: 79.9,
    regularPrice: undefined,
    pixPrice: 71.91,
    installmentText: "Até 2x de R$ 39,95 sem juros",
  },
  {
    ...baseProduct,
    id: 3,
    slug: "kit-de-ferramentas",
    name: "Kit de Ferramentas para Manutenção Residencial",
    sku: "KIT-FER-001",
    price: 159.9,
    regularPrice: 189.9,
    pixPrice: 143.91,
    installmentText: "Até 5x de R$ 31,98 sem juros",
  },
  {
    ...baseProduct,
    id: 4,
    slug: "fita-impermeabilizante",
    name: "Fita Impermeabilizante para Reparos Rápidos",
    sku: "FIT-IMP-001",
    price: 39.9,
    regularPrice: undefined,
    pixPrice: 35.91,
    installmentText: "R$ 39,90 no cartão",
  },
  {
    ...baseProduct,
    id: 5,
    slug: "disjuntor-eletrico",
    name: "Disjuntor Elétrico para Instalações Residenciais",
    sku: "DIS-ELE-001",
    price: 24.9,
    regularPrice: undefined,
    pixPrice: 22.41,
    installmentText: "R$ 24,90 no cartão",
    available: false,
    stockQuantity: 0,
  },
];

export const demoProducts: Product[] = [baseProduct, ...relatedProducts];

export function getDemoProduct(slug: string): Product | undefined {
  return demoProducts.find((product) => product.slug === slug);
}

export function getRelatedDemoProducts(productId: number): Product[] {
  return demoProducts
    .filter((product) => product.id !== productId)
    .slice(0, 4);
}
