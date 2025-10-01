import { z } from 'zod';

export const AiVerdict = z.enum(['LIKELY_OK', 'CAUTION', 'HIGH_RISK']);

export const AiOutputFinalSchema = z.object({
  bullets: z.array(z.string()).min(1).max(5),
  advice: z.string().min(1),
  clarity_final: z.number().min(0).max(100),
  safety_final: z.number().min(0).max(100),
  verdict: AiVerdict,
  reasons: z.array(z.string()).optional()
});

export type AiOutputFinal = z.infer<typeof AiOutputFinalSchema>;

