import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgresStorageService } from './postgres-storage.service';

@Module({
    imports: [ConfigModule],
    providers: [PostgresStorageService],
    exports: [PostgresStorageService],
})
export class StorageModule { }

