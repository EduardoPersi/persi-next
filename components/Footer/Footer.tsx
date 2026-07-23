import {
  Clock,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";

import { Container } from "@/components/UI/Container";

const categories = [
  { label: "Acabamentos", href: "/categoria/acabamentos" },
  {
    label: "Materiais de construção",
    href: "/categoria/materiais-de-construcao",
  },
  { label: "Hidráulica", href: "/categoria/hidraulica" },
  { label: "Banheiros", href: "/categoria/banheiros" },
  { label: "Ferragens", href: "/categoria/ferragens" },
  { label: "Ferramentas", href: "/categoria/ferramentas" },
  { label: "Elétrica", href: "/categoria/eletrica" },
  { label: "Pintura", href: "/categoria/pintura" },
  { label: "Utilidades", href: "/categoria/utilidades" },
];

const institutionalLinks = [
  { label: "Sobre nós", href: "/sobre-nos" },
  {
    label: "Política de troca e devolução",
    href: "/politica-de-troca-e-devolucao",
  },
  { label: "Dúvidas frequentes", href: "/duvidas-frequentes" },
  { label: "Política de pagamento", href: "/politica-de-pagamento" },
  {
    label: "Política de privacidade e segurança",
    href: "/politica-de-privacidade-e-seguranca",
  },
  { label: "Política de segurança", href: "/politica-de-seguranca" },
  { label: "Política de entrega", href: "/politica-de-entrega" },
  { label: "Termos de uso", href: "/termos-de-uso" },
];

const usefulLinks = [
  { label: "Frete grátis na região", href: "/frete-gratis-na-regiao" },
  { label: "Minha conta", href: "/minha-conta" },
  { label: "Pedidos", href: "/minha-conta/pedidos" },
  { label: "Trocas e devoluções", href: "/trocas-e-devolucoes" },
  { label: "Contato", href: "/contato" },
  { label: "Rastrear pedido", href: "/rastrear-pedido" },
];

const footerLinkClasses =
  "inline-flex min-h-9 items-center text-sm text-slate-600 transition-colors hover:text-[#ff6a00]";

type FooterLinksProps = {
  items: ReadonlyArray<{ label: string; href: string }>;
};

function FooterLinks({ items }: FooterLinksProps) {
  return (
    <ul className="mt-3 space-y-0.5 md:mt-4">
      {items.map(({ label, href }) => (
        <li key={href}>
          <Link href={href} className={footerLinkClasses}>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Footer() {
  return (
    <footer className="overflow-x-hidden bg-white text-slate-800">
      <section
        aria-labelledby="newsletter-title"
        className="bg-[#1246ab] text-white"
      >
        <Container className="flex flex-col gap-3 py-4 md:gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="mx-auto flex w-full max-w-[92%] items-center gap-2 md:mx-0 md:w-auto md:max-w-none md:gap-3">
            <Image
              src="/images/footer/newsletter.webp"
              alt=""
              width={100}
              height={55}
              sizes="(min-width: 768px) 48px, 56px"
              className="h-auto w-14 shrink-0 object-contain md:w-12"
            />
            <h2
              id="newsletter-title"
              className="text-xl font-bold"
            >
              Assine nossa newsletter
            </h2>
          </div>

          <form className="mx-auto flex w-full max-w-[92%] flex-col gap-2 md:mx-0 md:max-w-none md:flex-row md:gap-3 lg:max-w-xl">
            <label htmlFor="footer-email" className="sr-only">
              E-mail
            </label>
            <input
              id="footer-email"
              name="email"
              type="email"
              placeholder="E-mail"
              autoComplete="email"
              className="box-border h-11 w-full min-w-0 rounded-[6px] border border-slate-200 bg-white px-4 text-sm leading-normal text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20 md:w-auto md:flex-1 md:rounded-md"
            />
            <button
              type="button"
              className="box-border flex h-11 min-h-0 w-full items-center justify-center rounded-[6px] bg-[#ff6a00] px-8 text-sm font-medium leading-normal text-white transition-colors duration-200 hover:bg-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1246ab] md:w-auto md:rounded-md"
            >
              ENVIAR
            </button>
          </form>
        </Container>
      </section>

      <Container className="py-6 md:py-9 lg:py-10">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-7 md:gap-x-10 lg:grid-cols-4 lg:gap-7">
          <section aria-labelledby="footer-contact-title">
            <h2
              id="footer-contact-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Contato
            </h2>

            <ul className="mt-3 space-y-1.5 text-sm leading-5 text-slate-600 md:mt-4 md:leading-6">
              <li className="flex items-start gap-3">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0 text-[#ff6a00]"
                />
                <address className="not-italic">
                  <strong className="font-semibold text-slate-800">
                    ENDEREÇO:
                  </strong>{" "}
                  Rua Itirapina, 163, Vila Lacerda, Jundiaí - SP
                </address>
              </li>
              <li>
                <a
                  href="https://wa.me/551139648294"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Conversar com a Persi Materiais pelo WhatsApp"
                  className="flex min-h-9 items-center gap-3 hover:text-[#ff6a00]"
                >
                  <WhatsAppIcon
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-[#ff6a00]"
                  />
                  WhatsApp: (11) 3964-8294
                </a>
              </li>
              <li>
                <a
                  href="tel:+5511996340689"
                  className="flex min-h-9 items-center gap-3 hover:text-[#ff6a00]"
                >
                  <Phone
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-[#ff6a00]"
                  />
                  Telefone: (11) 99634-0689
                </a>
              </li>
              <li>
                <a
                  href="mailto:vendas@persimateriais.com.br"
                  className="flex min-h-9 items-center gap-3 break-all hover:text-[#ff6a00]"
                >
                  <Mail
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-[#ff6a00]"
                  />
                  E-mail: vendas@persimateriais.com.br
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Clock
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0 text-[#ff6a00]"
                />
                <span>
                  <strong className="font-semibold text-slate-800">
                    Horário de atendimento:
                  </strong>
                  <br />
                  Segunda a sexta: 7h30 às 18h
                  <br />
                  Sábado: 7h30 às 14h
                </span>
              </li>
            </ul>
          </section>

          <nav aria-labelledby="footer-categories-title">
            <h2
              id="footer-categories-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Categorias
            </h2>
            <FooterLinks items={categories} />
          </nav>

          <nav aria-labelledby="footer-institutional-title">
            <h2
              id="footer-institutional-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Institucional
            </h2>
            <FooterLinks items={institutionalLinks} />
          </nav>

          <div>
            <nav aria-labelledby="footer-useful-title">
              <h2
                id="footer-useful-title"
                className="text-sm font-bold text-[#ff6a00] md:text-base"
              >
                Links úteis
              </h2>
              <FooterLinks items={usefulLinks} />
            </nav>

            <section
              aria-labelledby="footer-social-title"
              className="mt-5 md:mt-8"
            >
              <h2
                id="footer-social-title"
                className="text-sm font-bold text-[#ff6a00] md:text-base"
              >
                Redes Sociais:
              </h2>
              <div className="mt-3 flex flex-wrap gap-3 md:mt-4">
                <a
                  href="https://www.facebook.com/pemaconbr/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Acessar Facebook da Persi Materiais"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1877f2] text-white transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877f2] focus-visible:ring-offset-2 md:h-10 md:w-10"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-current md:h-5 md:w-5"
                  >
                    <path d="M13.5 21v-8h2.8l.42-3.2H13.5V7.75c0-.93.26-1.56 1.62-1.56h1.73V3.33c-.3-.04-1.33-.13-2.52-.13-2.5 0-4.2 1.52-4.2 4.32V9.8H7.3V13h2.83v8h3.37Z" />
                  </svg>
                </a>

                <a
                  href="https://www.instagram.com/persimateriais/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Acessar Instagram da Persi Materiais"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d62976] focus-visible:ring-offset-2 md:h-10 md:w-10"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-none stroke-current md:h-5 md:w-5"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </a>

                <a
                  href="https://www.youtube.com/@persimateriais"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Acessar YouTube da Persi Materiais"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#ff0000] text-white transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0000] focus-visible:ring-offset-2 md:h-10 md:w-10"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-current md:h-5 md:w-5"
                  >
                    <path d="M21.58 7.19a2.74 2.74 0 0 0-1.93-1.94C17.95 4.8 12 4.8 12 4.8s-5.95 0-7.65.45a2.74 2.74 0 0 0-1.93 1.94A28.5 28.5 0 0 0 2 12a28.5 28.5 0 0 0 .42 4.81 2.74 2.74 0 0 0 1.93 1.94c1.7.45 7.65.45 7.65.45s5.95 0 7.65-.45a2.74 2.74 0 0 0 1.93-1.94A28.5 28.5 0 0 0 22 12a28.5 28.5 0 0 0-.42-4.81ZM10 15.1V8.9l5.2 3.1-5.2 3.1Z" />
                  </svg>
                </a>

                <a
                  href="https://www.tiktok.com/@persimateriais/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Acessar TikTok da Persi Materiais"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black text-white transition duration-200 hover:scale-105 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 md:h-10 md:w-10"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 fill-current md:h-5 md:w-5"
                  >
                    <path d="M16.6 3c.3 1.8 1.33 2.88 3.1 3.22v3.03a8.2 8.2 0 0 1-3.07-.72v5.74a6.27 6.27 0 1 1-5.4-6.21v3.08a3.23 3.23 0 1 0 2.33 3.1V3h3.04Z" />
                  </svg>
                </a>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-5 pt-4 md:mt-6 md:grid-cols-2 md:gap-7 md:gap-x-8 md:pt-6 lg:grid-cols-4 lg:gap-6">
          <section
            aria-labelledby="footer-brand-title"
            className="lg:max-w-[260px]"
          >
            <h2 id="footer-brand-title" className="text-lg font-bold">
              <Image
                src="/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp"
                alt="Persi Materiais Elétricos, Hidráulicos e Ferramentas"
                width={80}
                height={33}
                className="h-auto w-[80px] max-w-full object-contain"
              />
            </h2>
            <p className="mt-2 text-sm leading-5 text-slate-600 md:mt-3 md:leading-6">
              As fotos dos produtos são meramente ilustrativas. Os valores
              mencionados são válidos somente para compras online neste
              website. Nota fiscal para pessoa jurídica, fora do estado de São
              Paulo, está sujeita à cobrança adicional de ICMS Substituição
              Tributária, conforme a legislação aplicável.
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-700 md:mt-3">
              Persi Construções e Comércio LTDA
            </p>
          </section>

          <section aria-labelledby="footer-payment-title">
            <h2
              id="footer-payment-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Formas de pagamento
            </h2>
            <Image
              src="/images/footer/pagamentos.webp"
              alt="Formas de pagamento aceitas pela Persi Materiais"
              width={295}
              height={82}
              sizes="(min-width: 1024px) 230px, (min-width: 768px) 40vw, 100vw"
              className="mt-3 h-auto w-full max-w-[190px] object-contain md:max-w-[230px]"
            />
          </section>

          <section aria-labelledby="footer-security-title">
            <h2
              id="footer-security-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Site seguro
            </h2>
            <div className="mt-3 flex flex-col items-start gap-2">
              <Image
                src="/images/footer/bandeiras-de-seguranca.webp"
                alt="Selos de segurança do site Persi Materiais"
                width={250}
                height={60}
                sizes="(min-width: 1024px) 220px, (min-width: 768px) 40vw, 100vw"
                className="h-auto w-full max-w-[190px] object-contain md:max-w-[220px]"
              />
              <a
                href="https://transparencyreport.google.com/safe-browsing/search?url=persimateriais.com.br"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Verificar a segurança do site da Persi Materiais no Google Safe Browsing"
                className="inline-flex max-w-full"
              >
                <Image
                  src="/images/footer/site-seguro.webp"
                  alt="Site seguro verificado pelo Google Safe Browsing"
                  width={145}
                  height={45}
                  sizes="195px"
                  className="h-auto w-full max-w-[120px] object-contain md:max-w-[135px]"
                />
              </a>
            </div>
          </section>

          <section aria-labelledby="footer-shipping-title">
            <h2
              id="footer-shipping-title"
              className="text-sm font-bold text-[#ff6a00] md:text-base"
            >
              Formas de envio
            </h2>
            <Image
              src="/images/footer/transportadoras.webp"
              alt="Transportadoras utilizadas pela Persi Materiais"
              width={300}
              height={105}
              sizes="(min-width: 1024px) 230px, (min-width: 768px) 40vw, 100vw"
              className="mt-3 h-auto w-full max-w-[190px] object-contain md:max-w-[230px]"
            />
          </section>
        </div>
      </Container>

      <div className="border-t border-[#E5E7EB] bg-slate-50">
        <Container className="py-4 text-center text-[13px] leading-5 text-slate-500">
          <p>
            © 2016-2026 Persi Construções e Comércio Ltda. CNPJ:
            26.069.136/0001-41. Todos os direitos reservados.
          </p>
        </Container>
      </div>
    </footer>
  );
}
