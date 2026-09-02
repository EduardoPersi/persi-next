export type ShippingProviderErrorCode =
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "AUTH"
  | "NO_SERVICE";

export class ShippingProviderError extends Error {
  readonly code: ShippingProviderErrorCode;
  readonly status: number;

  constructor(message: string, code: ShippingProviderErrorCode, status: number) {
    super(message);
    this.name = "ShippingProviderError";
    this.code = code;
    this.status = status;
  }
}

export class ShippingValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "ShippingValidationError";
    this.issues = issues;
  }
}
