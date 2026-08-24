export type CatalogDataSource = "woocommerce" | "postgres";

function rate(value: string | undefined): number {
  const parsed=Number(value);
  return Number.isFinite(parsed)?Math.min(1,Math.max(0,parsed)):0;
}

export interface CatalogFeatureFlags {
  dataSource: CatalogDataSource;
  shadowEnabled: boolean;
  shadowSampleRate: number;
  shadowTimeoutMs: number;
}

export function getCatalogFeatureFlags(environment: NodeJS.ProcessEnv=process.env): CatalogFeatureFlags {
  return {
    dataSource: environment.CATALOG_DATA_SOURCE==="postgres"?"postgres":"woocommerce",
    shadowEnabled: environment.CATALOG_SHADOW_READ_ENABLED==="true",
    shadowSampleRate: rate(environment.CATALOG_SHADOW_SAMPLE_RATE),
    shadowTimeoutMs: Math.min(2_000,Math.max(50,Number(environment.CATALOG_SHADOW_TIMEOUT_MS)||500)),
  };
}

export function shouldSampleShadow(flags: CatalogFeatureFlags,random=Math.random): boolean {
  return flags.shadowEnabled&&flags.shadowSampleRate>0&&random()<flags.shadowSampleRate;
}
