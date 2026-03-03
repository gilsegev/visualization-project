import { BadRequestException } from '@nestjs/common';

const num = (v: string | undefined, d: number, min = 1, max = 100000) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(min, Math.min(max, Math.floor(n)));
};

export const payloadLimits = {
    maxLessons: () => num(process.env.MAX_LESSONS_PER_REQUEST, 20, 1, 200),
    maxVisualizationsPerLesson: () => num(process.env.MAX_VISUALIZATIONS_PER_LESSON, 20, 1, 200),
    maxTextLen: () => num(process.env.MAX_TEXT_FIELD_LENGTH, 4000, 100, 20000),
};

const assertText = (v: unknown, field: string, maxLen: number) => {
    if (v == null) return;
    const s = String(v);
    if (s.length > maxLen) throw new BadRequestException(`${field} exceeds max length ${maxLen}`);
};

export function enforceManifestLimits(manifest: any): void {
    const maxLessons = payloadLimits.maxLessons();
    const maxViz = payloadLimits.maxVisualizationsPerLesson();
    const maxText = payloadLimits.maxTextLen();
    const lessons = manifest?.lessons || manifest?.course?.lessons || [];
    if (!Array.isArray(lessons) || lessons.length === 0) {
        throw new BadRequestException('Manifest must include lessons with visualizations');
    }
    if (lessons.length > maxLessons) {
        throw new BadRequestException(`lessons exceed max ${maxLessons}`);
    }
    for (let i = 0; i < lessons.length; i++) {
        const lesson = lessons[i] || {};
        assertText(lesson.title, `lessons[${i}].title`, 300);
        const visualizations = lesson.visualizations || [];
        if (!Array.isArray(visualizations) || visualizations.length === 0) {
            throw new BadRequestException(`lessons[${i}].visualizations must be a non-empty array`);
        }
        if (visualizations.length > maxViz) {
            throw new BadRequestException(`lessons[${i}].visualizations exceed max ${maxViz}`);
        }
        for (let j = 0; j < visualizations.length; j++) {
            const viz = visualizations[j] || {};
            assertText(viz.title, `lessons[${i}].visualizations[${j}].title`, 300);
            assertText(viz.type, `lessons[${i}].visualizations[${j}].type`, 80);
            assertText(viz.description, `lessons[${i}].visualizations[${j}].description`, maxText);
            assertText(viz.context, `lessons[${i}].visualizations[${j}].context`, maxText);
            assertText(viz.purpose, `lessons[${i}].visualizations[${j}].purpose`, maxText);
        }
    }
}

export function enforceCourseLimits(courseJob: any): void {
    const maxText = payloadLimits.maxTextLen();
    const maxViz = payloadLimits.maxVisualizationsPerLesson();
    if (!Array.isArray(courseJob?.visualizations) || courseJob.visualizations.length === 0) {
        throw new BadRequestException('visualizations must be a non-empty array');
    }
    if (courseJob.visualizations.length > maxViz) {
        throw new BadRequestException(`visualizations exceed max ${maxViz}`);
    }
    assertText(courseJob?.metadata?.title, 'metadata.title', 300);
    assertText(courseJob?.metadata?.audience, 'metadata.audience', 300);
    assertText(courseJob?.metadata?.global_style_guide, 'metadata.global_style_guide', maxText);
    for (let i = 0; i < courseJob.visualizations.length; i++) {
        assertText(courseJob.visualizations[i]?.prompt, `visualizations[${i}].prompt`, maxText);
    }
}

