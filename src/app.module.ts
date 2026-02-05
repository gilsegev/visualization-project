import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ImageGenModule } from './image-gen/image-gen.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', '..', 'public'), // Check path depth depending on dist structure
        }),
        ImageGenModule
    ],
})
export class AppModule { }
