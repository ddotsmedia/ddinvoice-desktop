import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { Perm, ZodBody } from '../common/decorators';
import { ApiException } from '../common/api-exception';
import { ZodPipe } from '../common/zod.pipe';
import {
  CreateInvoiceSchema,
  ListInvoicesSchema,
  UpdateInvoiceSchema,
  type CreateInvoiceInput,
  type ListInvoicesQuery,
  type UpdateInvoiceInput,
} from './invoices.schemas';
import { InvoicesService } from './invoices.service';

/** If-Match carries the expected invoice version (plain or quoted integer). */
export function parseIfMatch(header: string | undefined): number {
  const v = Number((header ?? '').replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(v) || v < 1) {
    throw ApiException.validation('If-Match header with the invoice version is required', { 'If-Match': 'required' });
  }
  return v;
}

@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Perm('invoice.create')
  @ZodBody(CreateInvoiceSchema)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(CreateInvoiceSchema)) body: CreateInvoiceInput) {
    return this.invoices.create(auth, body);
  }

  @Perm('invoice.read')
  @Get()
  list(@Query(new ZodPipe(ListInvoicesSchema)) q: ListInvoicesQuery) {
    return this.invoices.list(q);
  }

  @Perm('invoice.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Perm('invoice.update')
  @ZodBody(UpdateInvoiceSchema)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodPipe(UpdateInvoiceSchema)) body: UpdateInvoiceInput,
  ) {
    return this.invoices.update(id, body, parseIfMatch(ifMatch));
  }

  @Perm('invoice.delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.remove(id);
  }

  @Perm('invoice.issue')
  @Post(':id/issue')
  issue(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.issue(auth, id);
  }

  @Perm('invoice.update')
  @Post(':id/mark-sent')
  markSent(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.markSent(id);
  }
}
