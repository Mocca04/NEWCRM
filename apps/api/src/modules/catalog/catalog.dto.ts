import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

const VERTICALS = ['MANICURE', 'BARBERSHOP', 'HAIR_SALON', 'OTHER'] as const;
const MAX_MONEY = 2_000_000_000;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Barbería' })
  @IsString()
  @Length(2, 40)
  name: string;

  @ApiPropertyOptional({ enum: VERTICALS })
  @IsOptional()
  @IsIn(VERTICALS)
  vertical?: (typeof VERTICALS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class LoadTemplateDto {
  @ApiProperty({ enum: ['MANICURE', 'BARBERSHOP', 'HAIR_SALON'] })
  @IsIn(['MANICURE', 'BARBERSHOP', 'HAIR_SALON'])
  vertical: 'MANICURE' | 'BARBERSHOP' | 'HAIR_SALON';
}

export class CreateServiceDto {
  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Corte y barba' })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty({ description: 'Precio en centavos de COP. $25.000 = 2500000' })
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  price: number;

  @ApiProperty({ description: 'Duración del servicio en minutos' })
  @IsInt()
  @Min(5)
  @Max(720)
  durationMinutes: number;

  @ApiPropertyOptional({ description: 'Minutos de preparación antes del servicio' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  prepMinutes?: number;

  @ApiPropertyOptional({ description: 'Minutos de limpieza después del servicio' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  cleanupMinutes?: number;

  @ApiPropertyOptional({ description: 'Anticipo exigido al reservar, en centavos de COP' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  depositAmount?: number;

  @ApiPropertyOptional({ description: 'Tipo de recurso que ocupa (silla, cabina). Vacío = ninguno' })
  @IsOptional()
  @IsString()
  @Length(0, 40)
  resourceType?: string;

  @ApiPropertyOptional({ description: 'Visible en el portal público de reservas' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Profesionales habilitados para este servicio' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}
export class UpdateServiceDto extends PartialType(CreateServiceDto) {}

export class ServicePriceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ description: 'Precio en centavos de COP' })
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  price: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(720)
  durationMinutes?: number;
}

export class SetServicePricesDto {
  @ApiProperty({ type: [ServicePriceDto], description: 'Tarifas distintas por profesional y/o sucursal. Reemplaza las existentes.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServicePriceDto)
  prices: ServicePriceDto[];
}
