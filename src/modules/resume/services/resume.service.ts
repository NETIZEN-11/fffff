import { resumeRepository } from "@/modules/resume/repositories/resume.repository";
import { storageService } from "@/modules/resume/services/storage.service";
import { db } from "@/lib/db";
import type { CreateResumeInput, UpdateResumeInput } from "@/modules/resume/schemas/resume.schema";
import type { PaginationMeta } from "@/types";
import type { Resume } from "@prisma/client";

const MAX_FREE_RESUMES = 3;

export class ResumeService {
  async uploadAndCreate(
    file: File,
    data: CreateResumeInput,
    userId: string
  ) {
    // Check subscription limits
    const subscription = await db.subscription.findUnique({
      where: { userId },
    });

    if (subscription?.plan === "FREE") {
      const count = await resumeRepository.countByUser(userId);
      if (count >= MAX_FREE_RESUMES) {
        throw new Error(
          "Free plan allows a maximum of 3 resumes. Please upgrade to Pro."
        );
      }
    }

    // Upload to storage
    const uploaded = await storageService.uploadResume(file, userId);

    // Create DB record
    const resume = await resumeRepository.create({
      userId,
      title: data.title,
      description: data.description,
      fileUrl: uploaded.url,
      fileName: file.name,
      fileSize: file.size,
      fileType: uploaded.fileType,
      storagePath: uploaded.path,
      tags: data.tags,
    });

    return resume;
  }

  async getResume(id: string, userId: string) {
    const resume = await resumeRepository.findByIdWithFiles(id, userId);
    if (!resume) throw new Error("Resume not found");
    return resume;
  }

  async listResumes(
    userId: string,
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      sortBy?: "createdAt" | "updatedAt" | "title";
      sortOrder?: "asc" | "desc";
    }
  ): Promise<{ resumes: Resume[]; meta: PaginationMeta }> {
    return resumeRepository.list({ userId, ...params });
  }

  async updateResume(id: string, userId: string, data: UpdateResumeInput) {
    await this.assertOwnership(id, userId);
    return resumeRepository.update(id, userId, data);
  }

  async replaceResumeFile(id: string, userId: string, file: File) {
    await this.assertOwnership(id, userId);

    // Upload new file
    const uploaded = await storageService.uploadResume(file, userId);

    // Get old storage path for cleanup
    const existing = await resumeRepository.findById(id, userId);

    // Replace in DB
    const updated = await resumeRepository.replaceFile(id, userId, {
      fileUrl: uploaded.url,
      fileName: file.name,
      fileSize: file.size,
      fileType: uploaded.fileType,
      storagePath: uploaded.path,
    });

    // Clean up old file (non-blocking)
    if (existing?.storagePath) {
      storageService.deleteFile(existing.storagePath).catch(() => {});
    }

    return updated;
  }

  async deleteResume(id: string, userId: string) {
    const resume = await this.assertOwnership(id, userId);
    await resumeRepository.softDelete(id, userId);

    // Clean up storage (non-blocking)
    storageService.deleteFile(resume.storagePath).catch(() => {});
  }

  private async assertOwnership(id: string, userId: string): Promise<Resume> {
    const resume = await resumeRepository.findById(id, userId);
    if (!resume) throw new Error("Resume not found or access denied");
    return resume;
  }
}

export const resumeService = new ResumeService();
