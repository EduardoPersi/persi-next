export interface StockNotificationRequest {
  productId: number;
  variationId?: number;
  email: string;
  website: string;
}

export interface StockNotificationResponse {
  code: string;
  message: string;
}
