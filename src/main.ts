import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { isAllowedOrigin, parseAllowedOrigins } from './security/origin-allowlist';

dotenv.config();

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
    app.enableCors({
        origin: (origin, callback) => {
            if (isAllowedOrigin(origin, allowedOrigins)) return callback(null, true);
            return callback(new Error(`Origin not allowed: ${origin}`), false);
        },
        credentials: true,
    });
    // Log every request for debugging
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.originalUrl}`);
        next();
    });

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
