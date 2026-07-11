import { supabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import { ACCEPTED_MIME_TYPES, MAX_FILE_SIZE } from "@/constants";
import type { FileType } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

const MIME_TO_FILE_TYPE: Record<string, FileType> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

export type StorageUploadResult = {
  url: string;
  path: string;
  fileType: FileType;
};

export class StorageService {
  async uploadResume(
    file: File,
    userId: string
  ): Promise<StorageUploadResult> {
    // Validate MIME type
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      throw new Error("Invalid file type. Only PDF and DOCX files are accepted.");
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("File size exceeds 5MB limit.");
    }

    const fileType = MIME_TO_FILE_TYPE[file.type];
    if (!fileType) throw new Error("Unsupported file type");

    const ext = fileType === "PDF" ? ".pdf" : ".docx";
    const fileName = `${uuidv4()}${ext}`;
    const storagePath = `${userId}/resumes/${fileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return {
      url: urlData.publicUrl,
      path: storagePath,
      fileType,
    };
  }

  async deleteFile(storagePath: string): Promise<void> {
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath]);

    if (error) {
      console.error("Failed to delete file from storage:", error.message);
      // Don't throw — storage cleanup failures should not block DB operations
    }
  }

  async getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data) {
      throw new Error("Failed to generate download URL");
    }

    return data.signedUrl;
  }
}

export const storageService = new StorageService();
