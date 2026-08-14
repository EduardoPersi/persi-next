import Link from "next/link";
import { preload } from "react-dom";
import { HeroBannerControls } from "./HeroBannerControls";

const SLIDES = [
  { id: 1, desktopImage: "/images/slides/slide-01-impermeabilizantes-desktop.webp", mobileImage: "/images/slides/slide-01-impermeabilizantes-mobile.webp", title: "Impermeabilizantes para sua obra", description: "Soluções Viapol e Mactra para proteger cada etapa da construção.", href: "/busca?q=impermeabilizantes", alt: "Impermeabilizantes Viapol e Mactra disponíveis na Persi Materiais" },
  { id: 2, desktopImage: "/images/slides/slide-02-pex-gas-desktop.webp", mobileImage: "/images/slides/slide-02-pex-gas-mobile.webp", title: "Linha PEX para gás", description: "Tubos e conexões Astra para instalações de gás seguras e eficientes.", href: "/busca?q=pex+gas+astra", alt: "Tubos e conexões PEX para gás da Astra" },
  { id: 3, desktopImage: "/images/slides/slide-03-fortlev-desktop.webp", mobileImage: "/images/slides/slide-03-fortlev-mobile.webp", title: "Tubos e conexões Fortlev", description: "Qualidade e confiança para instalações hidráulicas residenciais e comerciais.", href: "/busca?q=tubos+conexoes+fortlev", alt: "Tubos e conexões hidráulicas Fortlev" },
  { id: 4, desktopImage: "/images/slides/slide-04-pex-agua-desktop.webp", mobileImage: "/images/slides/slide-04-pex-agua-mobile.webp", title: "Linha PEX para água", description: "Soluções Astra para água fria e quente com instalação prática.", href: "/busca?q=pex+agua+astra", alt: "Tubos e conexões PEX Astra para água fria e quente" },
] as const;

export function HeroBanner() {
  const firstSlide = SLIDES[0];
  preload(firstSlide.mobileImage, {
    as: "image",
    fetchPriority: "high",
    media: "(max-width: 1023px)",
  });
  preload(firstSlide.desktopImage, {
    as: "image",
    fetchPriority: "high",
    media: "(min-width: 1024px)",
  });

  return (
    <section data-hero-banner aria-label="Destaques da Persi Materiais" aria-roledescription="carrossel" className="group/hero relative overflow-hidden bg-slate-900">
      {SLIDES.map((slide, index) => (
        <article key={slide.id} data-hero-slide aria-label={`${index + 1} de ${SLIDES.length}`} aria-hidden={index !== 0} hidden={index !== 0} className="relative aspect-[375/280] w-full lg:aspect-auto lg:h-[clamp(360px,26vw,500px)]">
          <picture>
            <source media="(min-width: 1024px)" srcSet={slide.desktopImage} />
            <img src={slide.mobileImage} alt={slide.alt} width={375} height={280} loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "low"} decoding={index === 0 ? "sync" : "async"} className="absolute inset-0 h-full w-full object-cover" />
          </picture>
          <div className="absolute inset-0 flex items-center justify-center px-12 py-12 sm:px-[30%] sm:py-8">
            <div className="max-w-xl text-center text-white [text-shadow:0_2px_8px_rgb(0_0_0/55%)]">
              <h2 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{slide.title}</h2>
              <p className="mt-3 text-base font-medium sm:text-lg lg:text-xl">{slide.description}</p>
              <Link href={slide.href} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#ff6a00] px-6 py-3 font-semibold text-white no-underline shadow-md transition hover:bg-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#ff6a00]">Ver produtos</Link>
            </div>
          </div>
        </article>
      ))}

      <HeroBannerControls slideCount={SLIDES.length} />
    </section>
  );
}
