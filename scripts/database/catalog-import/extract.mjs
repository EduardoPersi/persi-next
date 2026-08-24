const MAX_ATTEMPTS = 4;

export class WooReadOnlyExtractor {
  constructor({ wordpressUrl, wooKey, wooSecret, timeoutMs = 15000 }) {
    this.baseUrl = wordpressUrl;
    this.authorization = `Basic ${Buffer.from(`${wooKey}:${wooSecret}`).toString("base64")}`;
    this.timeoutMs = timeoutMs;
    this.requests = 0;
    this.retries = 0;
  }

  async get(endpoint, query = {}) {
    const url = new URL(`/wp-json/wc/v3/${endpoint.replace(/^\/+/, "")}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      this.requests += 1;
      try {
        const response = await fetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: this.authorization }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (response.ok) return { data: await response.json(), total: Number(response.headers.get("x-wp-total")) || 0, totalPages: Number(response.headers.get("x-wp-totalpages")) || 0 };
        if (response.status !== 429 && response.status < 500) throw Object.assign(new Error(`Woo HTTP ${response.status}`), { systemic: response.status === 401 || response.status === 403 });
      } catch (error) {
        if (error.systemic || attempt === MAX_ATTEMPTS) throw error;
      }
      this.retries += 1;
      const delay = Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error("Woo retry esgotado.");
  }

  async *products({ limit, productId, sku, startPage = 1 }) {
    const perPage = Math.min(100, limit ?? 100);
    let yielded = 0;
    for (let page = startPage; ; page += 1) {
      const response = await this.get("products", { page, per_page: perPage, status: "any", include: productId, sku, orderby: "id", order: "asc" });
      if (!Array.isArray(response.data) || response.data.length === 0) return;
      for (const product of response.data) {
        yield { product, page };
        yielded += 1;
        if (limit && yielded >= limit) return;
      }
      if (page >= response.totalPages) return;
    }
  }

  async variations(productId) {
    const response = await this.get(`products/${productId}/variations`, { per_page: 100 });
    return Array.isArray(response.data) ? response.data : [];
  }

  async all(endpoint) {
    const first = await this.get(endpoint, { page: 1, per_page: 100, hide_empty: false });
    const rows = [...first.data];
    for (let page = 2; page <= first.totalPages; page += 1) rows.push(...(await this.get(endpoint, { page, per_page: 100, hide_empty: false })).data);
    return rows;
  }
}
