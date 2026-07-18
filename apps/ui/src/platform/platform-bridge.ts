export interface OpenAudioFilesOptions {
  readonly multiple: boolean;
}

export interface PlatformBridge {
  openAudioFiles(options: OpenAudioFilesOptions): Promise<string[]>;
  subscribeToDroppedFiles(
    callback: (paths: readonly string[]) => void,
  ): () => void;
}
