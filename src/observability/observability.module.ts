import { Module } from '@nestjs/common';
import { ObservabilityGateway } from './observability.gateway';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [StorageModule],
    providers: [ObservabilityGateway],
    exports: [ObservabilityGateway],
})
export class ObservabilityModule { }
