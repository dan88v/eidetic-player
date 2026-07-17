export class JsonLineParser {
  private buffer = "";

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onError: (error: Error, line: string) => void = () => {
      // Invalid lines are ignored unless a diagnostic callback is supplied.
    },
  ) {}

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        this.onMessage(JSON.parse(line) as unknown);
      } catch (error) {
        this.onError(
          error instanceof Error ? error : new Error(String(error)),
          line,
        );
      }
    }
  }

  reset(): void {
    this.buffer = "";
  }
}
