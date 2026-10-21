interface Window {
  // File System Access API; absent from TypeScript's DOM lib and from Safari and Firefox.
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}
