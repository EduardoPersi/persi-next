export interface StockNotificationSubscription {
  productId: number;
  variationId?: number;
  email: string;
  consent: true;
}

export type StockNotificationResult =
  | { status: "success" }
  | { status: "already_registered" };

export class StockNotificationError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "StockNotificationError";
  }
}

export async function subscribeToBackInStockNotification(
  subscription: StockNotificationSubscription,
): Promise<StockNotificationResult> {
  const endpoint = process.env.WORDPRESS_STOCK_NOTIFICATION_ENDPOINT;

  if (!endpoint) {
    throw new StockNotificationError(
      "A integração de aviso de estoque ainda não está configurada.",
      503,
    );
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 409) {
      return { status: "already_registered" };
    }

    if (!response.ok) {
      throw new StockNotificationError(
        "O WordPress não concluiu o cadastro do aviso de estoque.",
        response.status >= 500 ? 502 : response.status,
      );
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof StockNotificationError) {
      throw error;
    }

    throw new StockNotificationError(
      "Não foi possível acessar o serviço de aviso de estoque.",
    );
  }
}
