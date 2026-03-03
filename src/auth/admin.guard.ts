import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const role = String(req?.authUser?.role || '').toLowerCase();
        if (role === 'admin') return true;
        throw new ForbiddenException('Admin role required');
    }
}
