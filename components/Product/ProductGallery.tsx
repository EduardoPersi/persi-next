"use client";

import {
  ChevronLeft,
  ChevronRight,
  Mail,
  MessagesSquare,
  Send,
  Share2,
} from "lucide-react";
import Image from "next/image";
import {
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { A11y, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { ProductImage } from "@/types/product";
import { FacebookIcon, WhatsAppIcon } from "@/components/UI/SocialIcons";
import "swiper/css";
import "swiper/css/pagination";

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
}

const fallbackImage: ProductImage = {
  src: "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp",
  alt: "Imagem demonstrativa da Persi Materiais",
};

function subscribeToBrowserState() {
  return () => undefined;
}

export function ProductGallery({
  images,
  productName,
}: ProductGalleryProps) {
  const galleryImages = images.length > 0 ? images : [fallbackImage];
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const shareUrl = useSyncExternalStore(
    subscribeToBrowserState,
    () => window.location.href,
    () => "",
  );
  const canShareNatively = useSyncExternalStore(
    subscribeToBrowserState,
    () => typeof navigator.share === "function",
    () => false,
  );
  const hasMultipleImages = galleryImages.length > 1;

  function supportsImageZoom() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function handleZoomMove(event: MouseEvent<HTMLDivElement>) {
    if (!supportsImageZoom()) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;

    setZoomOrigin({ x, y });
  }

  function handleZoomEnter() {
    if (supportsImageZoom()) setIsZoomed(true);
  }

  function handleZoomLeave() {
    setIsZoomed(false);
    setZoomOrigin({ x: 50, y: 50 });
  }

  function selectImage(index: number) {
    setSelectedIndex(index);
    swiperRef.current?.slideTo(index);
    handleZoomLeave();
  }

  function showPreviousImage() {
    swiperRef.current?.slidePrev();
  }

  function showNextImage() {
    swiperRef.current?.slideNext();
  }

  async function shareNatively() {
    if (!navigator.share || !shareUrl) return;

    try {
      await navigator.share({
        title: productName,
        text: productName,
        url: shareUrl,
      });
      setIsShareMenuOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(productName);
  const encodedMessage = encodeURIComponent(`${productName} ${shareUrl}`);

  return (
    <section
      aria-label={`Galeria de imagens de ${productName}`}
      onContextMenu={(event) => event.preventDefault()}
      className="min-w-0 max-w-full"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
        <Swiper
          modules={[A11y, Pagination]}
          slidesPerView={1}
          spaceBetween={0}
          allowTouchMove
          threshold={8}
          resistance
          resistanceRatio={0.85}
          rewind
          watchSlidesProgress
          pagination={hasMultipleImages ? { clickable: true } : false}
          onSwiper={(swiper) => {
            swiperRef.current = swiper;
          }}
          onSlideChange={(swiper) => {
            setSelectedIndex(swiper.activeIndex);
            handleZoomLeave();
          }}
          className="h-full w-full [&_.swiper-pagination-bullet-active]:bg-[#0c2d72]"
        >
          {galleryImages.map((image, index) => (
            <SwiperSlide key={`${image.src}-${index}`}>
              <div
                className="relative h-full w-full overflow-hidden md:cursor-zoom-in"
                onMouseEnter={handleZoomEnter}
                onMouseMove={handleZoomMove}
                onMouseLeave={handleZoomLeave}
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  priority={index === 0}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  className="select-none object-contain p-6 transition-transform duration-200 ease-out sm:p-8"
                  style={{
                    transform:
                      isZoomed && selectedIndex === index
                        ? "scale(1.8)"
                        : "scale(1)",
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                  }}
                />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>

        <div className="absolute right-3 top-3 z-20">
          <button
            type="button"
            onClick={() => setIsShareMenuOpen((current) => !current)}
            aria-label={`Compartilhar ${productName}`}
            aria-expanded={isShareMenuOpen}
            aria-controls="product-share-menu"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#0c2d72] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </button>
          {isShareMenuOpen ? (
            <div
              id="product-share-menu"
              className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-700 shadow-lg"
            >
              {canShareNatively ? (
                <button
                  type="button"
                  onClick={() => void shareNatively()}
                  className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  Compartilhar pelo celular
                </button>
              ) : null}
              <ShareLink
                href={`https://wa.me/?text=${encodedMessage}`}
                label="WhatsApp"
                icon={<WhatsAppIcon className="h-4 w-4" aria-hidden="true" />}
              />
              <ShareLink
                href={`sms:?body=${encodedMessage}`}
                label="Mensagens"
                icon={<MessagesSquare className="h-4 w-4" aria-hidden="true" />}
              />
              <ShareLink
                href={`mailto:?subject=${encodedText}&body=${encodedMessage}`}
                label="E-mail"
                icon={<Mail className="h-4 w-4" aria-hidden="true" />}
              />
              <ShareLink
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                label="Facebook"
                icon={<FacebookIcon className="h-4 w-4" aria-hidden="true" />}
              />
              <ShareLink
                href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`}
                label="Telegram"
                icon={<Send className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
          ) : null}
        </div>

        {hasMultipleImages ? (
          <>
            <button
              type="button"
              onClick={showPreviousImage}
              aria-label="Exibir imagem anterior"
              className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-[#0c2d72] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={showNextImage}
              aria-label="Exibir próxima imagem"
              className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-[#0c2d72] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 max-w-full gap-3 overflow-x-auto pb-2">
        {galleryImages.map((image, index) => {
          const isSelected = index === selectedIndex;

          return (
            <button
              key={`${image.src}-${index}`}
              type="button"
              onClick={() => selectImage(index)}
              aria-label={`Exibir imagem ${index + 1} de ${productName}`}
              aria-pressed={isSelected}
              className={`relative aspect-square w-20 shrink-0 overflow-hidden rounded-xl border bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-[#0c2d72]"
                  : "border-slate-200 hover:border-slate-400"
              }`}
            >
              <Image
                src={image.src}
                alt=""
                fill
                sizes="80px"
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                className="select-none object-contain p-2"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface ShareLinkProps {
  href: string;
  label: string;
  icon: ReactNode;
}

function ShareLink({ href, label, icon }: ShareLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-10 items-center gap-3 rounded-lg px-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
    >
      {icon}
      {label}
    </a>
  );
}
