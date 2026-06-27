// Extract raw text from agenda/minutes documents.
//
// Tier A: pdf-parse (npm) for text-layer PDFs — fast, no cost.
// Tier B: AWS Textract for scanned/image PDFs — ~$0.0015/page.
//         Requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION env vars.
// Tier C: HTML stripping for HTML documents.
//
// Returns null if the document can't be fetched or yields no usable text.
//
// NOTE: This module intentionally avoids referencing process/Buffer directly
// so it remains type-safe under the project tsconfig (no node lib).
// Buffer and process are available in the Next.js Node.js runtime at
// execution time — they are only referenced inside dynamic async expressions
// that TypeScript does not type-check as globals.

const UA = 'FaradayIntelligence/1.0 (research@faraday-intelligence.ai)';
const MAX_CHARS = 100_000;

export async function extractDocumentText(sourceUrl: string): Promise<string | null> {
  if (!sourceUrl) return null;

  let res: Response;
  try {
    res = await fetch(sourceUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error(`extractDocumentText: fetch failed for ${sourceUrl}:`, e);
    return null;
  }

  if (!res.ok) return null;

  const ct = res.headers.get('content-type') ?? '';

  if (ct.includes('pdf') || sourceUrl.toLowerCase().endsWith('.pdf')) {
    const arrayBuf = await res.arrayBuffer();
    return extractPdfText(arrayBuf);
  }

  if (ct.includes('html') || ct.includes('text')) {
    const html = await res.text();
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CHARS);
  }

  return null;
}

async function extractPdfText(arrayBuf: ArrayBuffer): Promise<string> {
  // Primary: pdf-parse (text-layer PDFs, no external service needed).
  // Accessed via globalThis to avoid module-not-found at build time when the
  // optional dependency is absent.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // String-split prevents TypeScript from statically resolving the optional dep
    const pdfParse = await import('pdf' + '-parse').catch(() => null) as any;

    if (pdfParse) {
      const buf = (globalThis as any).Buffer?.from(arrayBuf) ?? arrayBuf; // eslint-disable-line @typescript-eslint/no-explicit-any
      const result: { text: string } = await (pdfParse.default ?? pdfParse)(buf);
      if (result.text && result.text.trim().length > 100) {
        return result.text.slice(0, MAX_CHARS);
      }
    }
  } catch {
    // pdf-parse not installed or document is image-only — try Textract
  }

  // Fallback: AWS Textract for scanned PDFs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const awsKey = (globalThis as any).process?.env?.AWS_ACCESS_KEY_ID;
  if (awsKey) {
    try {
      const mod = await import('@aws-sdk' + '/client-textract').catch(() => null);
      if (mod) {
        const { TextractClient, DetectDocumentTextCommand } = mod;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const region = (globalThis as any).process?.env?.AWS_REGION ?? 'us-east-1';
        const client = new TextractClient({ region });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bytes  = (globalThis as any).Buffer?.from(arrayBuf) ?? new Uint8Array(arrayBuf);
        const result = await client.send(
          new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = (result.Blocks ?? [])
          .filter((b: { BlockType?: string }) => b.BlockType === 'LINE')
          .map((b: { Text?: string }) => b.Text ?? '')
          .join(' ');
        return text.slice(0, MAX_CHARS);
      }
    } catch (e) {
      console.error('Textract fallback failed:', e);
    }
  }

  return '';
}
