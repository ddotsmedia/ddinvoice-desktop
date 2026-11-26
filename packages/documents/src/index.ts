export const invoiceHtml = (p: { number: string; total: string }): string =>
  `<!doctype html><html><body><h1>Invoice <bdi>${p.number}</bdi></h1><p><bdi>${p.total}</bdi> AED</p></body></html>`;
