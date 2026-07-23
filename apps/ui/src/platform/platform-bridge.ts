export interface OpenAudioFilesOptions {
  readonly multiple: boolean;
}

export interface PlatformBridge {
  openAudioFiles(options: OpenAudioFilesOptions): Promise<string[]>;
  openFolder(): Promise<string | null>;
  openNetworkSettings?(): Promise<void>;
  subscribeToDroppedFiles(
    callback: (paths: readonly string[]) => void,
  ): () => void;
}
