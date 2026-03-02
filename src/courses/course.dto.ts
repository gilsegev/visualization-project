import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class CourseMetadataDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(300)
    title!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(300)
    audience!: string;

    @IsOptional()
    @IsString()
    @MaxLength(4000)
    global_style_guide?: string;
}

export class CenterTopicDto {
    @IsString() @IsNotEmpty() @MaxLength(300) title!: string;
    @IsString() @IsNotEmpty() @MaxLength(4000) description!: string;
}

export class VisualizationItemDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(4000)
    prompt!: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => CenterTopicDto)
    center_topic?: CenterTopicDto;
}

export class CourseJobDto {
    @ValidateNested()
    @Type(() => CourseMetadataDto)
    metadata!: CourseMetadataDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => VisualizationItemDto)
    visualizations!: VisualizationItemDto[];
}

export type CourseJob = CourseJobDto;

