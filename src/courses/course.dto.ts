export interface CourseMetadata {
    title: string;
    audience: string;
    global_style_guide?: string;
}

export interface VisualizationItem {
    prompt: string;
    center_topic?: {
        title: string;
        description: string;
    };
}

export interface CourseJob {
    metadata: CourseMetadata;
    visualizations: VisualizationItem[];
}
