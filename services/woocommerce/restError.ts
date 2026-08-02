export class WooCommerceRestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WooCommerceRestError";
    this.status = status;
  }
}
