import { Injectable } from '@nestjs/common';

@Injectable()
export class WorkerResourceSemaphoreService {
  private insertionLockOwner: string | null = null;
  private insertionLockAcquiredAt: number | null = null;

  acquireInsertionLock(ownerId: string): boolean {
    const owner = String(ownerId || '').trim();
    if (!owner) return false;
    if (!this.insertionLockOwner) {
      this.insertionLockOwner = owner;
      this.insertionLockAcquiredAt = Date.now();
      return true;
    }
    return this.insertionLockOwner === owner;
  }

  releaseInsertionLock(ownerId: string): void {
    const owner = String(ownerId || '').trim();
    if (!owner) return;
    if (this.insertionLockOwner === owner) {
      this.insertionLockOwner = null;
      this.insertionLockAcquiredAt = null;
    }
  }

  isInsertionLockActive(): boolean {
    return Boolean(this.insertionLockOwner);
  }

  getInsertionLockSnapshot(): { active: boolean; owner: string | null; acquired_at: string | null } {
    return {
      active: this.isInsertionLockActive(),
      owner: this.insertionLockOwner,
      acquired_at: this.insertionLockAcquiredAt ? new Date(this.insertionLockAcquiredAt).toISOString() : null,
    };
  }
}
