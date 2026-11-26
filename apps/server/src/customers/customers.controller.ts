import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Perm, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CreateCustomerSchema, ListCustomersSchema, type CreateCustomerInput } from './customers.schemas';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Perm('customer.create')
  @ZodBody(CreateCustomerSchema)
  @Post()
  create(@Body(new ZodPipe(CreateCustomerSchema)) body: CreateCustomerInput) {
    return this.customers.create(body);
  }

  @Perm('customer.read')
  @Get()
  list(@Query(new ZodPipe(ListCustomersSchema)) q: { q?: string; limit: number }) {
    return this.customers.list(q.q, q.limit);
  }

  @Perm('customer.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }
}
