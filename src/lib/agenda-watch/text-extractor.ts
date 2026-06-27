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

async function extractPdfText(buf: Buffer): Promise<string | null> {
  try {
    // Dynamic import — pdfjs-dist is a dev-time only dep; falls through gracefully.
    const pdfParse = await import('pdf-parse').then(m => m.default ?? m).catch(() => null);
    if (!pdfParse) return extractPdfTextViaTextract(buf);
    const data = await pdfParse(buf, { max: 0 });
    return data.text?.trim() ?? null;
  } catch {
    return extractPdfTextViaTextract(buf);
  }
}

async function extractPdfTextViaTextract(buf: Buffer): Promise<string | null> {
  if (!process.env.AWS_ACCESS_KEY_ID) return null;
  try {
    const { TextractClient, DetectDocumentTextCommand } = await import('@aws-sdk/client-textract');
    const client  = new TextractClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const cmd     = new DetectDocumentTextCommand({ Document: { Bytes: buf } });
    const result  = await client.send(cmd);
    const lines   = (result.Blocks ?? [])
      .filter(b => b.BlockType === 'LINE' && b.Text)
      .map(b => b.Text!);
    return lines.join('\n').trim() || null;
  } catch {
    return null;
  }
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
