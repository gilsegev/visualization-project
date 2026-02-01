import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalStorageService {
    private readonly logger = new Logger(LocalStorageService.name);
    private readonly uploadDir = path.join(process.cwd(), 'public', 'generated-images');

    constructor() {
        this.ensureDirectoryExists();
    }

    private ensureDirectoryExists() {
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
            this.logger.log(`Created upload directory: ${this.uploadDir}`);
        }
    }

    async upload(buffer: Buffer, fileName: string): Promise<string> {
        const filePath = path.join(this.uploadDir, fileName);
        await fs.promises.writeFile(filePath, buffer);
        this.logger.log(`Saved file: ${filePath}`);

        // Return relative URL assuming static assets are served from 'public' root
        return `/generated-images/${fileName}`;
    }
}
