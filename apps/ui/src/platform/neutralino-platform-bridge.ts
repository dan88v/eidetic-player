import { supportedAudioExtensions } from "../../../../packages/shared/src/audio";
import type { NeutralinoRuntime } from "./neutralino-runtime";
import type { OpenAudioFilesOptions, PlatformBridge } from "./platform-bridge";

interface FilesDroppedDetail {
  readonly files?: readonly string[];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return String(error);
}

export class NeutralinoPlatformBridge implements PlatformBridge {
  constructor(private readonly runtime: NeutralinoRuntime) {}

  async openAudioFiles(options: OpenAudioFilesOptions): Promise<string[]> {
    try {
      const result = await this.runtime.os.showOpenDialog("Open audio files", {
        multiSelections: options.multiple,
        filters: [
          { name: "Audio files", extensions: [...supportedAudioExtensions] },
        ],
      });
      if (!Array.isArray(result)) return [];
      return result.filter((path): path is string => typeof path === "string");
    } catch (error) {
      throw new Error(`The native file dialog failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  async openFolder(): Promise<string | null> {
    try {
      const result = await this.runtime.os.showFolderDialog(
        "Select a music folder",
      );
      return typeof result === "string" && result.length > 0 ? result : null;
    } catch (error) {
      throw new Error(
        `The native folder dialog failed: ${errorMessage(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  subscribeToDroppedFiles(
    callback: (paths: readonly string[]) => void,
  ): () => void {
    const listener = (event: { readonly detail?: unknown }): void => {
      const detail = event.detail;
      const paths = Array.isArray(detail)
        ? detail
        : detail && typeof detail === "object" && "files" in detail
          ? (detail as FilesDroppedDetail).files
          : [];
      callback(
        paths?.filter((path): path is string => typeof path === "string") ?? [],
      );
    };
    void Promise.resolve(
      this.runtime.events.on("filesDropped", listener),
    ).catch((error: unknown) => {
      console.error("[platform] unable to register filesDropped", error);
    });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      void Promise.resolve(
        this.runtime.events.off("filesDropped", listener),
      ).catch((error: unknown) => {
        console.error("[platform] unable to remove filesDropped", error);
      });
    };
  }
}
