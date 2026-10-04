/**
 * IDs de analytics configuráveis e OPCIONAIS.
 *
 * O site NÃO injeta GA4 nem Pixel por conta própria: o GTM (configurado pelo
 * Eduardo) é quem os carrega. Estes IDs só são oferecidos ao contêiner pelo
 * `dataLayer` (`ga4_measurement_id`, `meta_pixel_id`), para o GTM usá-los como
 * variável em vez de ter o número escrito dentro dele. Em branco = nada vai ao
 * dataLayer e nada trava.
 *
 * Os valores entram num script inline, então só passam se tiverem o formato
 * exato de um ID — qualquer outra coisa é descartada, nunca interpolada.
 */

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const PIXEL_ID = /^\d{5,20}$/;

export interface IdsDeAnalytics {
  ga4_measurement_id?: string;
  meta_pixel_id?: string;
}

export function lerIdsDeAnalytics(
  ga4: string | undefined,
  pixel: string | undefined,
): IdsDeAnalytics {
  const ids: IdsDeAnalytics = {};
  const g = ga4?.trim();
  const p = pixel?.trim();
  if (g && GA4_ID.test(g)) ids.ga4_measurement_id = g;
  if (p && PIXEL_ID.test(p)) ids.meta_pixel_id = p;
  return ids;
}

export const IDS_DE_ANALYTICS: IdsDeAnalytics = lerIdsDeAnalytics(
  process.env.NEXT_PUBLIC_GA4_ID,
  process.env.NEXT_PUBLIC_META_PIXEL_ID,
);
