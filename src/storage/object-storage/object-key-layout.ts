export interface DocumentObjectKeyInput {
  jobId: string;
  fileName?: string;
}

export const DocumentObjectKeyLayout = {
  inputSource(input: DocumentObjectKeyInput): string {
    return `documents/${input.jobId}/input/${input.fileName || 'source.docx'}`;
  },
  analysisJson(input: DocumentObjectKeyInput, fileName = 'analysis.json'): string {
    return `documents/${input.jobId}/analysis/${fileName}`;
  },
  asset(input: DocumentObjectKeyInput, fileName: string): string {
    return `documents/${input.jobId}/assets/${fileName}`;
  },
  outputFinal(input: DocumentObjectKeyInput, fileName = 'final.docx'): string {
    return `documents/${input.jobId}/output/${fileName}`;
  }
};
