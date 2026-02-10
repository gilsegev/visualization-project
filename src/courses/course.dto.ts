export interface CourseMetadata {
    title: string;
    target_audience: string;
    global_style_guide: {
        philosophy: string;
        palette: string[];
        font_preferences: string;
        image_style: string;
    };
}

export interface VisualizationItem {
    id: string;
    lesson: string;
    title: string;
    objective: string;
    description: string;
    suggested_template: string;
}

export interface CourseJob {
    course_id: string;
    course_metadata: CourseMetadata;
    visualizations: VisualizationItem[];
}

export interface BatchResult {
    course_id: string;
    global_style_anchor: string;
    images: {
        visualization_id: string;
        url: string;
    }[];
}
