export function alternateLoopbackHost(host: string): string {
  if (host === "127.0.0.1") return "localhost";
  if (host === "localhost") return "127.0.0.1";
  return host;
}

export function alternateLoopbackUrl(host: string, port: number): string {
  return `http://${alternateLoopbackHost(host)}:${String(port)}`;
}
