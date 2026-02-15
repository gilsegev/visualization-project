import { Module } from '@nestjs/common';
import { ObservabilityGateway } from './observability.gateway';

@Module({
    providers: [ObservabilityGateway],
    exports: [ObservabilityGateway],
})
export class ObservabilityModule { }
