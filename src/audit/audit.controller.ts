import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  action?: string;
}

/** Consultation réservée aux administrateurs : le journal contient qui a fait quoi. */
@Controller('admin/audit-logs')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query, {
      actorId: query.actorId,
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
    });
  }

  @Get(':entityType/:entityId')
  history(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.audit.history(entityType, entityId);
  }
}
