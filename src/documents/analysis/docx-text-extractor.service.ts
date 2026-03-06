import { Injectable } from '@nestjs/common';
import JSZip = require('jszip');

function decodeXmlEntities(input: string): string {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'');
}

function normalizeWhitespace(input: string): string {
  return String(input || '').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}

function stripXml(text: string): string {
  return String(text || '').replace(/<[^>]+>/g, '');
}

@Injectable()
export class DocxTextExtractorService {
  async extractPlainText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = zip.file('word/document.xml');
    if (!documentXml) return '';
    const xml = await documentXml.async('string');
    return this.extractFromDocumentXml(xml);
  }

  extractFromDocumentXml(xml: string): string {
    const out: string[] = [];
    const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
    const paragraphs = String(xml || '').match(paragraphRegex) || [];
    for (const paragraph of paragraphs) {
      const textRuns: string[] = [];
      const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      let m: RegExpExecArray | null = textRegex.exec(paragraph);
      while (m) {
        const chunk = normalizeWhitespace(decodeXmlEntities(stripXml(m[1] || '')));
        if (chunk) textRuns.push(chunk);
        m = textRegex.exec(paragraph);
      }
      const joined = normalizeWhitespace(textRuns.join(' '));
      if (joined) out.push(joined);
    }
    return out.join('\n\n');
  }
}
