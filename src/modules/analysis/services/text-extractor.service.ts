import pdfParse from "pdf-parse";
import mammoth from "mammoth";

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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mimeType =
      fileType === "PDF"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return this.extractFromBuffer(buffer, mimeType);
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
