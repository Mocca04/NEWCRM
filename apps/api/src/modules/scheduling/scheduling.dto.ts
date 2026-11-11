import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const KINDS = ['BLOCK', 'BREAK', 'VACATION', 'HOLIDAY'] as const;

export class CreateTimeBlockDto {
  @ApiPropertyOptional({ enum: KINDS, default: 'BLOCK' })
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @ApiProperty({ example: '2026-12-24T14:00:00-05:00' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-12-25T23:59:00-05:00' })
  @IsDateString()
  endsAt: string;

  @ApiPropertyOptional({ description: 'Profesional bloqueado. Sin profesional, aplica a toda la sucursal.' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Sucursal bloqueada. Sin sucursal ni profesional, aplica a todo el negocio.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 120)
  reason?: string;
}

export class CreateResourceDto {
  @ApiProperty()
  @IsUUID()
  branchId: string;

  @ApiProperty({ example: 'Silla 1' })
  @IsString()
  @Length(1, 40)
  name: string;

  @ApiProperty({ example: 'silla', description: 'Debe coincidir con el tipo de recurso que piden los servicios' })
  @IsString()
  @Length(2, 40)
  type: string;
}

export class UpdateResourceDto extends PartialType(OmitType(CreateResourceDto, ['branchId'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
