export function createReport(options) {
  return {
    mode: options.dryRun ? "dry-run" : "import",
    startedAt: new Date().toISOString(),
    source: { products: 0, simple: 0, variable: 0, variants: 0, skuPresent: 0, gtinValid: 0, brands: 0, categories: 0, media: 0, attributes: 0 },
    results: { valid: 0, imported: 0, skipped: 0, conflicts: 0, failed: 0, attributesMapped: 0, attributesUnmapped: 0 },
    issues: [],
    performance: { requests: 0, retries: 0, durationMs: 0, productsPerMinute: 0 },
  };
}

export function addIssue(report, productId, issue) {
  report.issues.push({ productId, ...issue });
  if (issue.code === "ATTRIBUTE_UNMAPPED") report.results.attributesUnmapped += 1;
}

export function finalizeReport(report, extractor, started) {
  report.finishedAt = new Date().toISOString();
  report.performance.requests = extractor.requests;
  report.performance.retries = extractor.retries;
  report.performance.durationMs = Math.round(performance.now() - started);
  report.performance.productsPerMinute = report.performance.durationMs ? Math.round(report.source.products * 600000 / report.performance.durationMs) / 10 : 0;
  return report;
}
