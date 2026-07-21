import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { assertSafeUrl, SSRFBlockedError } from "@/lib/ssrf-guard";
import { logger } from "@/lib/logger";

export class TextExtractorService {
  async extractFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
    if (mimeType === "application/pdf") {
      return this.extractFromPdf(buffer);
    }

    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return this.extractFromDocx(buffer);
    }

    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  async extractFromUrl(url: string, fileType: "PDF" | "DOCX"): Promise<string> {
    // SSRF guard: refuse to fetch from private IPs, loopback, cloud metadata.
    // This protects against a Resume row whose fileUrl was set to an
    // internal endpoint (e.g. via SQL injection or a misconfigured admin tool).
    try {
      await assertSafeUrl(url);
    } catch (err) {
      if (err instanceof SSRFBlockedError) {
        logger.error({ url }, "Refusing to fetch resume from unsafe URL");
        throw new Error("Resume file URL is not accessible.");
      }
      throw err;
    }

    // Cap response size — a 100MB file would OOM the worker.
    const MAX_BYTES = 25 * 1024 * 1024; // 25MB

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000), // 15s — larger than JD fetch
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declared = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        throw new Error("Resume file is too large.");
      }
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      throw new Error("Resume file is too large.");
    }
    const buffer = Buffer.from(arrayBuffer);

    const mimeType =
      fileType === "PDF"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return this.extractFromBuffer(buffer, mimeType);
  }

  /**
   * Returns the cached extracted text for a resume, or fetches + extracts
   * + persists it. Saves the file-fetch + parse cost on every re-analysis.
   */
  async getOrExtract(resumeId: string, fileUrl: string, fileType: "PDF" | "DOCX"): Promise<string> {
    const { db } = await import("@/lib/db");
    const resume = await db.resume.findUnique({
      where: { id: resumeId },
      select: { extractedText: true, extractedAt: true },
    });
    if (resume?.extractedText && resume.extractedAt) {
      return resume.extractedText;
    }
    const text = await this.extractFromUrl(fileUrl, fileType);
    // Persist so the next analysis skips fetch + parse. Errors are
    // non-fatal — we'll just re-extract next time.
    await db.resume
      .update({
        where: { id: resumeId },
        data: { extractedText: text, extractedAt: new Date() },
      })
      .catch((err) => {
        logger.error({ resumeId, err }, "Failed to cache extracted text");
      });
    return text;
  }

  private async extractFromPdf(buffer: Buffer): Promise<string> {
    const data = await pdfParse(buffer);
    return this.cleanText(data.text);
  }

  private async extractFromDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return this.cleanText(result.value);
  }

  cleanText(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .replace(/^\s+|\s+$/gm, "")
      .trim();
  }
}

export const textExtractorService = new TextExtractorService();
