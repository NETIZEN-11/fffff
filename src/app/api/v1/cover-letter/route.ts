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

    // Extract resume text from file
    const { textExtractorService } = await import(
      "@/modules/analysis/services/text-extractor.service"
    );
    const resumeText = await textExtractorService.extractFromUrl(
      resume.fileUrl,
      resume.fileType
    );

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

    const coverLetter = response.choices[0]?.message?.content?.trim();
    if (!coverLetter) throw new Error("No response from AI");

    return successResponse(
      {
        coverLetter,
        jobTitle: jobDescription.title,
        company: jobDescription.company ?? "",
        tone: validated.tone,
        wordCount: coverLetter.split(/\s+/).filter(Boolean).length,
      },
      "Cover letter generated"
    );
  } catch (error) {
    if (error instanceof ZodError) return validationErrorResponse(error);
    return handleApiError(error);
  }
}
