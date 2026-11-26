import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Perm, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { QuotesService } from './quotes.service';
import { CreateQuoteSchema, UpdateQuoteSchema, type CreateQuoteInput, type UpdateQuoteInput } from './quotes.schemas';

const ListSchema = z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional() });

@ApiTags('quotes')
@Controller('quotes')
class QuotesController {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  @Perm('quote.create')
  @ZodBody(CreateQuoteSchema)
  @Post()
  create(@Body(new ZodPipe(CreateQuoteSchema)) body: CreateQuoteInput) {
    return this.quotes.create(body);
  }

  @Perm('quote.read')
  @Get()
  list(@Query(new ZodPipe(ListSchema)) q: { status?: string }) {
    return this.quotes.list(q.status);
  }

  @Perm('quote.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Perm('quote.update')
  @ZodBody(UpdateQuoteSchema)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateQuoteSchema)) body: UpdateQuoteInput) {
    return this.quotes.update(id, body);
  }

  @Perm('quote.update')
  @Post(':id/send')
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(id);
  }

  @Perm('quote.update')
  @Post(':id/revise')
  revise(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.revise(id);
  }

  @Perm('quote.update')
  @Post(':id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.accept(id);
  }
}

@Module({ controllers: [QuotesController], providers: [QuotesService] })
export class QuotesModule {}
