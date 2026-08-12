import { STORE_INFO } from "@/lib/constants/storeInfo";

export function StoreMap() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(
    apiKey,
  )}&q=${encodeURIComponent(STORE_INFO.address.query)}`;

  return (
    <iframe
      title={`Localização da ${STORE_INFO.name} no mapa`}
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="h-[360px] w-full rounded-xl border border-slate-200"
    />
  );
}
