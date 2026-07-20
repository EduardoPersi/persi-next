import { ProductCard, type ProductCardProps } from "./ProductCard";

const DEMO_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

const demoProducts: ProductCardProps[] = [
  {
    name: "Torneira para cozinha de parede cromada",
    image: DEMO_IMAGE,
    href: "/produto/torneira-para-cozinha",
    price: 89.9,
    brand: "Persi",
    priority: true,
  },
  {
    name: "Kit de ferramentas para manutenção residencial",
    image: DEMO_IMAGE,
    href: "/produto/kit-de-ferramentas",
    price: 159.9,
    regularPrice: 189.9,
    brand: "Persi",
  },
  {
    name: "Fita impermeabilizante para reparos rápidos",
    image: DEMO_IMAGE,
    href: "/produto/fita-impermeabilizante",
    price: 39.9,
    brand: "Persi",
    badge: "Mais vendido",
  },
  {
    name: "Disjuntor elétrico para instalações residenciais",
    image: DEMO_IMAGE,
    href: "/produto/disjuntor-eletrico",
    price: 24.9,
    brand: "Persi",
    available: false,
  },
];

export function ProductGridDemo() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
      {demoProducts.map((product) => (
        <ProductCard key={product.href} {...product} />
      ))}
    </div>
  );
}
