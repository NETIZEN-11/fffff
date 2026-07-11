import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/shared/utils/api-response";
import { ZodError } from "zod";

type Params = { params: Promise<{ id: string }> };

const updateJobDescSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  company: z.string().max(200).optional(),
  description: z.string().min(50).max(50000).optional(),
  url: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string()).max(10).optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id } = await params;
    const jd = await db.jobDescription.findFirst({
      where: { id, userId: session.user.id, deletedAt: null },
    });

    if (!jd) return notFoundResponse("Job description");
    return successResponse(jd, "Job description retrieved");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = await req.json();
    const validated = updateJobDescSchema.parse(body);

    const existing = await db.jobDescription.findFirst({
      where: { id, userId: session.user.id, deletedAt: null },
    });
    if (!existing) return notFoundResponse("Job description");

    const jd = await db.jobDescription.update({
      where: { id },
      data: { ...validated, url: validated.url || null },
    });

    return successResponse(jd, "Job description updated");
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  try {
    const { id } = await params;
    const existing = await db.jobDescription.findFirst({
      where: { id, userId: session.user.id, deletedAt: null },
    });
    if (!existing) return notFoundResponse("Job description");

    await db.jobDescription.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return successResponse(null, "Job description deleted");
  } catch (error) {
    return handleApiError(error);
  }
}
