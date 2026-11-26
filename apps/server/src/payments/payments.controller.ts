import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Perm, ZodBody } from '../common/decorators';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { EventBus } from '../events/event-bus';
import { ZodPipe } from '../common/zod.pipe';
import { PaymentsService } from './payments.service';
import { AllocatePaymentSchema, CreatePaymentSchema, type AllocateInput, type CreatePaymentInput } from './payments.schemas';

@ApiTags('payments')
@Controller('payments')
class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  @Perm('payment.create')
  @ZodBody(CreatePaymentSchema)
  @Post()
  async create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(CreatePaymentSchema)) body: CreatePaymentInput) {
    const payment = await this.payments.create(body);
    this.bus.publish(auth.companyId, 'payment.created', { paymentId: payment.id });
    return payment;
  }

  @Perm('payment.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Perm('payment.update')
  @ZodBody(AllocatePaymentSchema)
  @Post(':id/allocate')
  allocate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AllocatePaymentSchema)) body: AllocateInput) {
    return this.payments.allocate(id, body);
  }

  @Perm('payment.post')
  @Post(':id/reverse')
  reverse(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.reverse(id);
  }
}

@Module({ controllers: [PaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
