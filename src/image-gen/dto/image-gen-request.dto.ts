import { Type } from 'class-transformer';
import { Allow, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class GenerateContentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(4000)
    content!: string;
}

export class GenerateManifestDto {
    @IsOptional()
    @Allow()
    course?: any;

    @IsOptional()
    @IsArray()
    @Allow()
    lessons?: any[];

    @IsOptional()
    @Allow()
    production?: any;
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
