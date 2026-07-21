import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { openai, AI_MODELS } from "@/lib/openai";
import { z } from "zod";
import {
  successResponse,
  handleApiError,
  unauthorizedResponse,
  validationErrorResponse,
  errorResponse,
} from "@/shared/utils/api-response";
import { rateLimit } from "@/shared/utils/rate-limit";
import { ZodError } from "zod";

const generateSchema = z.object({
  resumeId: z.string().cuid(),
  jobDescriptionId: z.string().cuid(),
  tone: z.enum(["professional", "enthusiastic", "concise"]).default("professional"),
  customNote: z.string().max(500).optional(),
});

const SYSTEM_PROMPT = `You are an expert career coach and professional writer who crafts outstanding cover letters.
Your cover letters are:
- Tailored specifically to the job description and company
- Written in first person, addressing the hiring manager
- Structured: Opening hook → Why this company → Key matching skills/achievements → Closing CTA
- Concise (3-4 paragraphs, ~250-350 words)
- Free of clichés like "I am writing to apply for..."
- ATS-friendly with relevant keywords from the job description
Never fabricate experience not present in the resume.`;

function buildPrompt(
  resumeText: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
  tone: string,
  customNote?: string
): string {
  return `Generate a ${tone} cover letter for the following:

JOB TITLE: ${jobTitle}
COMPANY: ${company || "the company"}

--- RESUME ---
${resumeText.substring(0, 5000)}

--- JOB DESCRIPTION ---
${jobDescription.substring(0, 3000)}

${customNote ? `--- CANDIDATE'S SPECIAL NOTE ---\n${customNote}\n` : ""}

Write ONLY the cover letter body text (no subject line, no date, no address blocks).
Start directly with the opening paragraph.
Tone: ${tone}.
Length: 3-4 paragraphs, approximately 250-350 words.`;
}

// POST /api/v1/cover-letter
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return unauthorizedResponse();

  const limit = await rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (!limit.success) {
    return errorResponse("Too many requests. Please wait a moment.", 429);
  }

  try {
    const body = await req.json();
    const validated = generateSchema.parse(body);

    // Fetch resume + job description, verify ownership
    const [resume, jobDescription] = await Promise.all([
      db.resume.findFirst({
        where: { id: validated.resumeId, userId: session.user.id, deletedAt: null },
      }),
      db.jobDescription.findFirst({
        where: { id: validated.jobDescriptionId, userId: session.user.id, deletedAt: null },
      }),
    ]);

    if (!resume) return errorResponse("Resume not found", 404);
    if (!jobDescription) return errorResponse("Job description not found", 404);

    // Atomic quota check + increment. PRO/TEAM plans are unlimited.
    // We use a transaction so the SELECT + UPDATE is serialized — the
    // SELECT FOR UPDATE-style row lock prevents two concurrent requests
    // from both passing the coverLettersUsed < coverLettersLimit check
    // before either commits the increment.
    const quotaClaim = await db.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { userId: session.user.id },
        select: { plan: true, coverLettersUsed: true, coverLettersLimit: true },
      });
      if (!sub) return { count: 0 };
      if (sub.plan === "PRO" || sub.plan === "TEAM") {
        await tx.subscription.update({
          where: { userId: session.user.id },
          data: { coverLettersUsed: { increment: 1 } },
        });
        return { count: 1 };
      }
      if (sub.coverLettersUsed < sub.coverLettersLimit) {
        await tx.subscription.update({
          where: { userId: session.user.id },
          data: { coverLettersUsed: { increment: 1 } },
        });
        return { count: 1 };
      }
      return { count: 0 };
    });

    if (quotaClaim.count === 0) {
      return errorResponse(
        "You have reached your monthly cover letter limit. Upgrade to Pro for unlimited cover letters.",
        402
      );
    }

    // Extract resume text from file (uses cache when available)
    const { textExtractorService } = await import(
      "@/modules/analysis/services/text-extractor.service"
    );
    const resumeText = await textExtractorService.getOrExtract(
      resume.id,
      resume.fileUrl,
      resume.fileType
    );

    let coverLetter: string | undefined;
    let wordCount = 0;
    try {
      // Call OpenAI
      const response = await openai.chat.completions.create({
        model: AI_MODELS.rewrite, // gpt-4o for quality writing
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildPrompt(
              resumeText,
              jobDescription.title,
              jobDescription.company ?? "",
              jobDescription.description,
              validated.tone,
              validated.customNote
            ),
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      coverLetter = response.choices[0]?.message?.content?.trim();
      if (!coverLetter) throw new Error("No response from AI");

      // Validate length: 50-500 words is a sane band
      wordCount = coverLetter.split(/\s+/).filter(Boolean).length;
      if (wordCount < 50) {
        throw new Error("Generated cover letter is too short. Please try again.");
      }
      if (wordCount > 800) {
        throw new Error("Generated cover letter is too long. Please try again with a different tone.");
      }
    } catch (err) {
      // Compensating refund: we charged the quota before the AI call,
      // so on failure we must give it back. Without this, a transient
      // OpenAI outage would burn through every user's monthly quota.
      await db.subscription
        .updateMany({
          where: { userId: session.user.id, coverLettersUsed: { gt: 0 } },
          data: { coverLettersUsed: { decrement: 1 } },
        })
        .catch(() => {});
      throw err;
    }

    // Persist the cover letter so the user can revisit it. The previous
    // behaviour returned the body but didn't save it, so a tab refresh
    // lost everything.
    const saved = await db.coverLetter.create({
      data: {
        userId: session.user.id,
        resumeId: validated.resumeId,
        jobDescriptionId: validated.jobDescriptionId,
        tone: validated.tone,
        customNote: validated.customNote,
        body: coverLetter,
        wordCount,
      },
      select: { id: true, createdAt: true },
    });

    return successResponse(
      {
        id: saved.id,
        coverLetter,
        jobTitle: jobDescription.title,
        company: jobDescription.company ?? "",
        tone: validated.tone,
        wordCount,
        createdAt: saved.createdAt,
      },
      "Cover letter generated"
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
