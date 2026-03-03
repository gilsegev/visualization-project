import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { isAllowedOrigin, parseAllowedOrigins } from './security/origin-allowlist';
import { ObservabilityGateway } from './observability/observability.gateway';

dotenv.config();

async function bootstrap() {
    const maxBodyMb = Math.max(1, Number(process.env.MAX_REQUEST_BODY_MB || 2));
    const app = await NestFactory.create(AppModule);
    app.use(json({ limit: `${maxBodyMb}mb` }));
    app.use(urlencoded({ extended: true, limit: `${maxBodyMb}mb` }));
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

    try {
        const observability = app.get(ObservabilityGateway);
        observability.emitLog(
            'info',
            'Startup config snapshot',
            'Startup',
            undefined,
            undefined,
            {
                metadata: {
                    event_kind: 'startup_snapshot',
                    process_role: 'app',
                    pid: process.pid,
                    node_env: process.env.NODE_ENV || 'development',
                    max_request_body_mb: maxBodyMb,
                    port: String(process.env.PORT || 3000),
                    durable_queue_enabled: String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true',
                    worker_count: Math.max(0, Number(process.env.WORKER_COUNT || 1)),
                    obs_live_stats_poll_ms: Math.max(500, Number(process.env.OBS_LIVE_STATS_POLL_MS || 1500)),
                    obs_live_stats_min_emit_ms: Math.max(500, Number(process.env.OBS_LIVE_STATS_MIN_EMIT_MS || 1000)),
                },
            },
        );
    } catch {
        // Best effort diagnostics only.
    }

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
