import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Laura Gómez' })
  @IsString()
  @Length(2, 80)
  fullName: string;

  @ApiProperty({ description: 'Sucursal donde atiende' })
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ example: ['Colorimetría', 'Uñas acrílicas'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(2, 40, { each: true })
  specialties?: string[];

  @ApiPropertyOptional({ description: 'Porcentaje de comisión sobre los servicios que presta (0 a 100)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPercent?: number;

  @ApiPropertyOptional({ description: 'Servicios que puede prestar' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  serviceIds?: string[];
}
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class SetEmployeeServicesDto {
  @ApiProperty()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  serviceIds: string[];
}

export class ScheduleEntryDto {
  @ApiProperty({ description: '0 = domingo, 1 = lunes ... 6 = sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: '09:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime debe tener formato HH:MM' })
  startTime: string;

  @ApiProperty({ example: '18:00', description: 'Hasta 24:00' })
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { message: 'endTime debe tener formato HH:MM' })
  endTime: string;
}

export class SetScheduleDto {
  @ApiProperty({ type: [ScheduleEntryDto], description: 'Horario semanal completo. Varios tramos en un día dejan un descanso entre ellos. Reemplaza el anterior.' })
  @IsArray()
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => ScheduleEntryDto)
  entries: ScheduleEntryDto[];
}
