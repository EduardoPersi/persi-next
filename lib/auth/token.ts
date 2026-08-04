const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Verifica somente a forma de transporte; validade e expiração são decididas pelo WordPress. */
export function isJwtFormat(value: string): boolean {
  return value.length <= 16_384 && JWT_PATTERN.test(value);
}
