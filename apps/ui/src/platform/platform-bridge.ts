export interface PlatformBridge {
  openAudioFiles(): Promise<string[]>;
  subscribeToDroppedFiles(
    callback: (paths: readonly string[]) => void,
  ): () => void;
}
