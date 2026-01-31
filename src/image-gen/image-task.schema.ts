import { z } from 'zod';

export const ImageTaskSchema = z.object({
    id: z.string().uuid(),
    type: z.enum(['visual_concept', 'data_viz', 'math_formula', 'beautify_slide']),
    refined_prompt: z.string(),
    payload: z.record(z.any()),
});

export type ImageTask = z.infer<typeof ImageTaskSchema>;
