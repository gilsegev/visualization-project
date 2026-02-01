import { z } from 'zod';

// Define specific payloads for better validation later
const DataVizPayload = z.object({
    chartType: z.string(),
    data: z.array(z.any()),
});

export const ImageTaskSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('visual_concept'), id: z.string().uuid(), refined_prompt: z.string(), payload: z.record(z.any()) }),
    z.object({ type: z.literal('data_viz'), id: z.string().uuid(), refined_prompt: z.string(), payload: DataVizPayload }),
    z.object({ type: z.literal('math_formula'), id: z.string().uuid(), refined_prompt: z.string(), payload: z.object({ latex: z.string() }) }),
    z.object({ type: z.literal('beautify_slide'), id: z.string().uuid(), refined_prompt: z.string(), payload: z.record(z.any()) }),
]);

export type ImageTask = z.infer<typeof ImageTaskSchema>;