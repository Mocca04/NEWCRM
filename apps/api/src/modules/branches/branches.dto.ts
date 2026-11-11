import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'Sede Norte' })
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 60)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 120)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Minutos entre inicios posibles de cita', enum: [5, 10, 15, 20, 30, 60], default: 15 })
  @IsOptional()
  @IsInt()
  @IsIn([5, 10, 15, 20, 30, 60])
  slotIntervalMinutes?: number;

  @ApiPropertyOptional({ description: 'Horario por dia: { "1": [["09:00","18:00"]], ... } (0 = domingo)' })
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, [string, string][]>;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}
