import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgresStorageService } from './postgres-storage.service';
import { R2ObjectStorageService } from './object-storage/r2-object-storage.service';

@Module({
    imports: [ConfigModule],
    providers: [PostgresStorageService, R2ObjectStorageService],
    exports: [PostgresStorageService, R2ObjectStorageService],
})
export class StorageModule { }
