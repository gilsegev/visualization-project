import { Module } from '@nestjs/common';
import { ImageGenModule } from './image-gen/image-gen.module';

@Module({
    imports: [ImageGenModule],
})
export class AppModule { }
