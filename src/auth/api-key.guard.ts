import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { PostgresStorageService } from '../storage/postgres-storage.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    private readonly rateLimitPerMinute = Math.max(1, Number(process.env.API_RATE_LIMIT_PER_MINUTE || 120));
    private readonly windowMs = 60_000;
    private readonly buckets = new Map<string, { windowStart: number; count: number }>();

    constructor(private readonly storage: PostgresStorageService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.storage.isEnabled()) return true;

        const req = context.switchToHttp().getRequest();
        const headerKey = req?.headers?.['x-api-key'];
        const bearer = String(req?.headers?.authorization || '').trim();
        const bearerKey = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
        const apiKey = String(Array.isArray(headerKey) ? headerKey[0] : (headerKey || bearerKey || '')).trim();

        if (!apiKey) throw new UnauthorizedException('Missing API key');

        const user = await this.storage.validateApiKey(apiKey);
        if (!user) throw new UnauthorizedException('Invalid API key');
        const units = this.resolveAssetUnits(req);
        this.enforceRateLimit(String(user.id), units);

        req.authUser = user;
        return true;
    }

    private enforceRateLimit(userId: string, units: number): void {
        const now = Date.now();
        const charge = Math.max(1, Math.floor(Number(units) || 1));
        if (charge > this.rateLimitPerMinute) {
            throw new HttpException(
                `Rate limit exceeded (${this.rateLimitPerMinute}/min). Request units=${charge}`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const bucket = this.buckets.get(userId);
        if (!bucket || (now - bucket.windowStart) >= this.windowMs) {
            this.buckets.set(userId, { windowStart: now, count: charge });
            return;
        }
        if ((bucket.count + charge) > this.rateLimitPerMinute) {
            throw new HttpException(`Rate limit exceeded (${this.rateLimitPerMinute}/min)`, HttpStatus.TOO_MANY_REQUESTS);
        }
        bucket.count += charge;
    }

    private resolveAssetUnits(req: any): number {
        const method = String(req?.method || '').toUpperCase();
        const route = String(req?.originalUrl || req?.url || '');
        if (method !== 'POST') return 1;

        const body = req?.body || {};
        if (route.includes('/generate/manifest')) {
            const lessons = Array.isArray(body?.lessons)
                ? body.lessons
                : Array.isArray(body?.course?.lessons)
                    ? body.course.lessons
                    : [];
            const manifestCount = lessons.reduce((sum: number, lesson: any) => {
                const visuals = Array.isArray(lesson?.visualizations) ? lesson.visualizations.length : 0;
                return sum + visuals;
            }, 0);
            return Math.max(1, manifestCount);
        }

        if (route === '/generate' || route.endsWith('/generate')) {
            const visuals = Array.isArray(body?.content?.visualizations) ? body.content.visualizations.length : 0;
            return Math.max(1, visuals);
        }

        return 1;
    }
}
