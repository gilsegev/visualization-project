export const DOCUMENT_MANIFEST_VERSION = 1 as const;

export interface DocumentManifestMeta {
  manifestVersion: typeof DOCUMENT_MANIFEST_VERSION;
  generatedAt: string;
}
