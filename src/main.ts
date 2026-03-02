import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { isAllowedOrigin, parseAllowedOrigins } from './security/origin-allowlist';

dotenv.config();

async function bootstrap() {
    const maxBodyMb = Math.max(1, Number(process.env.MAX_REQUEST_BODY_MB || 2));
    const rateLimitPerMinute = Math.max(1, Number(process.env.API_RATE_LIMIT_PER_MINUTE || 120));
    const rateWindowMs = 60_000;
    const rateBuckets = new Map<string, { windowStart: number; count: number }>();
    const app = await NestFactory.create(AppModule);
    app.use(json({ limit: `${maxBodyMb}mb` }));
    app.use(urlencoded({ extended: true, limit: `${maxBodyMb}mb` }));
    app.use((req, res, next) => {
        const headerKey = req?.headers?.['x-api-key'];
        const bearer = String(req?.headers?.authorization || '').trim();
        const bearerKey = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
        const apiKey = String(Array.isArray(headerKey) ? headerKey[0] : (headerKey || bearerKey || '')).trim();
        if (!apiKey) return next();
        const now = Date.now();
        const bucket = rateBuckets.get(apiKey);
        if (!bucket || (now - bucket.windowStart) >= rateWindowMs) {
            rateBuckets.set(apiKey, { windowStart: now, count: 1 });
            return next();
        }
        if (bucket.count >= rateLimitPerMinute) {
            return res.status(429).json({ message: `Rate limit exceeded (${rateLimitPerMinute}/min)` });
        }
        bucket.count += 1;
        return next();
    });
    app.useGlobalPipes(new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
    }));
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
