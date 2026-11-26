import { Injectable } from '@nestjs/common';
import { Subject, filter, takeUntil, type Observable } from 'rxjs';

export type LiveEventType = 'invoice.issued' | 'payment.created' | 'draft.updated' | 'presence' | 'session.revoked';

export interface LiveEvent {
  id: number;
  type: LiveEventType;
  companyId: string;
  at: string;
  data: Record<string, unknown>;
}

/**
 * In-process fan-out for the server's single process. Events are published after the owning transaction commits
 * (controllers publish once the service call resolves). Streams are scoped by company; a revoked session's stream closes.
 */
@Injectable()
export class EventBus {
  private readonly events = new Subject<LiveEvent>();
  private readonly closures = new Subject<string>();
  private seq = 0;

  publish(companyId: string, type: LiveEventType, data: Record<string, unknown>): LiveEvent {
    const event: LiveEvent = { id: ++this.seq, type, companyId, at: new Date().toISOString(), data };
    this.events.next(event);
    return event;
  }

  /** Live events for one company, ending when `sessionId` is closed (logout or revoke). */
  stream(companyId: string, sessionId: string): Observable<LiveEvent> {
    const closed = this.closures.pipe(filter((sid) => sid === sessionId));
    return this.events.pipe(
      filter((e) => e.companyId === companyId),
      takeUntil(closed),
    );
  }

  /** Ends every open stream belonging to this session (called on revoke). */
  closeSession(sessionId: string): void {
    this.closures.next(sessionId);
  }
}
