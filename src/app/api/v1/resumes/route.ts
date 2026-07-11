import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { resumeService } from "@/modules/resume/services/resume.service";
import { createResumeSchema, resumeQuerySchema } from "@/modules/resume/schemas/resume.schema";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  validationErrorResponse,
} from "@/shared/utils/api-response";
import { createAuditLog } from "@/shared/utils/audit-log";
import { ZodError } from "zod";

// GET /api/v1/resumes — List user resumes
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { searchParams } = req.nextUrl;
    const query = resumeQuerySchema.parse({
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
      search: searchParams.get("search"),
      sortBy: searchParams.get("sortBy"),
      sortOrder: searchParams.get("sortOrder"),
    });

    const result = await resumeService.listResumes(session.user.id, query);
    return successResponse(result.resumes, "Resumes retrieved", result.meta);
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}

// POST /api/v1/resumes — Upload new resume
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const tags = formData.getAll("tags") as string[];

    if (!file) {
      return handleApiError(new Error("No file provided"));
    }

    const validated = createResumeSchema.parse({ title, description, tags });
    const resume = await resumeService.uploadAndCreate(file, validated, session.user.id);

    await createAuditLog({
      userId: session.user.id,
      action: "UPLOAD",
      resource: "Resume",
      resourceId: resume.id,
      req,
    });

    return successResponse(resume, "Resume uploaded successfully", undefined, 201);
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
