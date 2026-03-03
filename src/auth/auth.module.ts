import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { AdminGuard } from './admin.guard';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [StorageModule],
    providers: [ApiKeyGuard, AdminGuard],
    exports: [ApiKeyGuard, AdminGuard],
})
export class AuthModule {}
