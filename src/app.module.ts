import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ImageGenModule } from './image-gen/image-gen.module';
import { ConfigModule } from '@nestjs/config';
import { CoursesModule } from './courses/courses.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), 'public'), // Serve public folder including dashboard
        }),
        ImageGenModule,
        ObservabilityModule,
        CoursesModule
    ],
})
export class AppModule { }
