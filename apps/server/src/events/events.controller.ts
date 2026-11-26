import { Controller, Global, Inject, MessageEvent, Module, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable } from 'rxjs';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { Perm, SkipIdempotency } from '../common/decorators';
import { EventBus } from './event-bus';

const HEARTBEAT_MS = 25_000;

/** GET /events: one SSE stream per signed-in client, scoped to the company. Heartbeat keeps proxies from closing it. */
@ApiTags('events')
@Controller()
export class EventsController {
  constructor(@Inject(EventBus) private readonly bus: EventBus) {}

  @Perm('invoice.read')
  @SkipIdempotency()
  @Sse('events')
  stream(@CurrentAuth() auth: AuthContext): Observable<MessageEvent> {
    const events = this.bus.stream(auth.companyId, auth.sessionId).pipe(
      map((e): MessageEvent => ({ id: String(e.id), type: e.type, data: e })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
    return merge(events, heartbeat);
  }
}

@Global()
@Module({ controllers: [EventsController], providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
