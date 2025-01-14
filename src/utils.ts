export type CompressionMethod = "gzip" | "zstd";

export function getCacheFilename(method: CompressionMethod): string {
  return `cache.tar.${method}`;
}

export function getWorkingDirectory(): string {
  return process.env["GITHUB_WORKSPACE"] ?? process.cwd();
}
