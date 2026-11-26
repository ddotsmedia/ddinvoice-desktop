import { RequiresModule } from '../license/license.guard';
import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { Perm, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Id } from '../common/dto';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteSchema, type CreateCreditNoteInput } from './credit-notes.schemas';

const ListSchema = z.object({ invoiceId: Id.optional() });

@ApiTags('credit-notes')
@RequiresModule('sales')
@Controller('credit-notes')
class CreditNotesController {
  constructor(@Inject(CreditNotesService) private readonly creditNotes: CreditNotesService) {}

  @Perm('creditnote.create')
  @ZodBody(CreateCreditNoteSchema)
  @Post()
  create(@Body(new ZodPipe(CreateCreditNoteSchema)) body: CreateCreditNoteInput) {
    return this.creditNotes.create(body);
  }

  @Perm('creditnote.read')
  @Get()
  list(@Query(new ZodPipe(ListSchema)) q: { invoiceId?: string }) {
    return this.creditNotes.list(q.invoiceId);
  }

  @Perm('creditnote.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotes.get(id);
  }

  @Perm('creditnote.issue')
  @Post(':id/issue')
  issue(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.creditNotes.issue(auth, id);
  }
}

@Module({ controllers: [CreditNotesController], providers: [CreditNotesService] })
export class CreditNotesModule {}
