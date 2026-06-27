// AgendaWatch text extraction.
// Downloads a document (PDF / HTML) and returns its plain text.
// Primary: PDF parse via pdf-parse / pdfjs-dist.
// Fallback: AWS Textract OCR (when AWS env vars are set).

import { Svc } from '@/lib/pipeline-utils';

interface AgendaWatchDoc {
  id:           string;
  document_url: string;
  document_type: string;
}

export async function extractDocumentText(
  doc: AgendaWatchDoc,
  _svc: Svc
): Promise<string | null> {
  const { document_url } = doc;
  if (!document_url) return null;

  try {
    const resp = await fetch(document_url, {
      headers: { 'User-Agent': 'Faraday-AgendaWatch/1.0' },
      signal:  AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') ?? '';

    if (contentType.includes('text/html')) {
      const html = await resp.text();
      return stripHtml(html);
    }

    if (contentType.includes('pdf') || document_url.toLowerCase().endsWith('.pdf')) {
      const buf  = Buffer.from(await resp.arrayBuffer());
      return await extractPdfText(buf);
    }

    // Plain text fallback
    return await resp.text();
  } catch (err) {
    console.error('[agenda-watch/text-extractor] failed', doc.id, err);
    return null;
  }
}

async function extractPdfText(_buf: Buffer): Promise<string | null> {
  // PDF text extraction requires pdf-parse or @aws-sdk/client-textract to be installed.
  // Neither is bundled — this path returns null until those packages are added as deps.
  // HTML and plain-text documents are extracted above without any extra packages.
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
