import { Type } from 'class-transformer';
import { Allow, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class GenerateContentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(4000)
    content!: string;
}

class ManifestCourseDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    title?: string;

    @IsOptional()
    @Allow()
    lessons?: any[];
}

class ManifestVisualizationDto {
    @IsOptional() @IsString() @MaxLength(64) visualizationId?: string;
    @IsOptional() @IsString() @MaxLength(80) type?: string;
    @IsOptional() @IsString() @MaxLength(300) title?: string;
    @IsOptional() @IsString() @MaxLength(4000) description?: string;
    @IsOptional() @IsString() @MaxLength(4000) context?: string;
    @IsOptional() @IsString() @MaxLength(4000) purpose?: string;
    @IsOptional() @IsString() @MaxLength(4000) content_description?: string;
    @IsOptional() @IsString() @MaxLength(4000) reasoning?: string;
    @IsOptional() @IsString() @MaxLength(200) placement?: string;
    @IsOptional() @IsInt() @Min(0) @Max(10000) section_number?: number;
    @IsOptional() @IsString() @MaxLength(300) section_title?: string;
    @IsOptional() @IsString() @MaxLength(40) chartType?: string;
    @IsOptional() @IsString() @MaxLength(20) format?: string;

    @IsOptional() @Allow() data?: any;
    @IsOptional() @Allow() structure?: any;
    @IsOptional() @Allow() imageSpecs?: any;
    @IsOptional() @Allow() styling?: any;
    @IsOptional() @Allow() style?: any;
    @IsOptional() @Allow() dimensions?: any;
}

class ManifestLessonDto {
    @IsOptional()
    @IsString()
    @MaxLength(64)
    lessonId?: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(300)
    title!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ManifestVisualizationDto)
    visualizations!: ManifestVisualizationDto[];
}

export class GenerateManifestDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => ManifestCourseDto)
    course?: ManifestCourseDto;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ManifestLessonDto)
    lessons?: ManifestLessonDto[];
}

export class SourceDebugDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    query!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    clip_brief?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(10)
    per_page?: number;

    @IsOptional()
    @IsIn(['horizontal', 'vertical'])
    orientation?: 'horizontal' | 'vertical';
}
