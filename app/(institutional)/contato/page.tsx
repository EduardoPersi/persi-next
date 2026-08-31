import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";
import { WhatsAppIcon } from "@/components/UI/SocialIcons";
import { ContactForm } from "@/components/Contact/ContactForm";
import { StoreMap } from "@/components/Contact/StoreMap";
import { STORE_INFO } from "@/lib/constants/storeInfo";

export const metadata: Metadata = {
  title: "Contato | Persi Materiais",
  description:
    "Fale com a Persi Materiais de Construção: endereço, telefone, WhatsApp, e-mail e horário de atendimento.",
  alternates: { canonical: "/contato" },
};

export default function ContactPage() {
  return (
    <>
      <Header />
      <main className="py-6 sm:py-8 lg:py-10">
        <Container size="lg">
          <h1 className="text-center text-2xl font-bold text-secondary sm:text-3xl">
            Entre em contato conosco para dúvidas e sugestões
          </h1>

          <div className="mt-8 grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {STORE_INFO.name}
              </h2>
              <p className="mt-3 flex items-start gap-3 text-sm text-muted">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                />
                {STORE_INFO.address.line}
              </p>
              <a
                href={STORE_INFO.whatsapp.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Conversar com a Persi Materiais pelo WhatsApp"
                className="tap-feedback mt-2 flex min-h-9 items-center gap-3 rounded-md text-sm text-muted transition-colors hover:text-secondary"
              >
                <WhatsAppIcon
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-primary"
                />
                {STORE_INFO.whatsapp.label}
              </a>
              <a
                href={STORE_INFO.phone.href}
                className="tap-feedback mt-2 flex min-h-9 items-center gap-3 rounded-md text-sm text-muted transition-colors hover:text-secondary"
              >
                <Phone
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-primary"
                />
                {STORE_INFO.phone.label}
              </a>
              <a
                href={STORE_INFO.email.href}
                className="tap-feedback mt-2 flex min-h-9 items-center gap-3 rounded-md text-sm text-muted transition-colors hover:text-secondary"
              >
                <Mail
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-primary"
                />
                {STORE_INFO.email.label}
              </a>

              <h2 className="mt-6 text-lg font-bold text-foreground">
                Horário de funcionamento
              </h2>
              <p className="mt-2 text-sm text-muted">
                {STORE_INFO.hours.weekdays}
              </p>
              <p className="mt-1 text-sm text-muted">
                {STORE_INFO.hours.saturday}
              </p>
            </div>

            <div>
              <ContactForm />
            </div>
          </div>

          <div className="mt-10">
            <h2 className="text-lg font-bold text-secondary">
              Nos encontre no mapa
            </h2>
            <div className="mt-4">
              <StoreMap />
            </div>
          </div>
        </Container>
      </main>
    </>
  );
}
