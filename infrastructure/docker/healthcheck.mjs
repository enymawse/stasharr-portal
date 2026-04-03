const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const url = `http://127.0.0.1:${port}/api/v1/status`;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 4000);

try {
  const response = await fetch(url, { signal: controller.signal });

  if (!response.ok) {
    throw new Error(`unexpected HTTP ${response.status}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Healthcheck failed for ${url}: ${message}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
