import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { resumeService } from "@/modules/resume/services/resume.service";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { createAuditLog } from "@/shared/utils/audit-log";

type Params = { params: Promise<{ id: string }> };

// POST /api/v1/resumes/:id/replace — replace the active file for an existing resume
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return errorResponse("No file provided", 400);
    }

    const resume = await resumeService.replaceResumeFile(id, session.user.id, file);

    await createAuditLog({
      userId: session.user.id,
      action: "UPLOAD",
      resource: "Resume",
      resourceId: id,
      metadata: { action: "replace_file", newFileName: file.name },
      req,
    });

    return successResponse(resume, "Resume file replaced successfully");
  } catch (error) {
    return handleApiError(error);
  }
}
