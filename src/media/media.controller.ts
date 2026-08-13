import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MediaService } from './media.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { Locale } from '../generated/prisma/enums';

class UploadMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  folder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alt?: string;
}

/** `folder` doit être déclaré : un paramètre non listé est rejeté par la validation. */
class ListMediaDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  folder?: string;
}

class SetAltDto {
  @IsString()
  @MaxLength(255)
  alt: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

@Controller('admin/media')
@Roles('MANAGER', 'ADMIN')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    return this.media.upload(file, dto);
  }

  @Get()
  list(@Query() dto: ListMediaDto) {
    return this.media.list(dto, dto.folder);
  }

  @Patch(':id/translations/:locale')
  setAlt(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @Body() dto: SetAltDto,
  ) {
    return this.media.setAlt(
      id,
      locale.toUpperCase() as Locale,
      dto.alt,
      dto.caption,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.media.remove(id);
  }
}
