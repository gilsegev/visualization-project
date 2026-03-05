import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { StorageModule } from '../../storage/storage.module';
import { DocumentIntakeController } from './document-intake.controller';
import { DocumentIntakeService } from './document-intake.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [DocumentIntakeController],
  providers: [DocumentIntakeService]
})
export class DocumentIntakeModule {}
