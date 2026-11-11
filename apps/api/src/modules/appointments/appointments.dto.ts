import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class AppointmentLineDto {
  @ApiProperty()
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ description: 'Sin profesional: se asigna cualquiera habilitado que esté libre' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class NewCustomerDto {
  @ApiProperty()
  @IsString()
  @Length(2, 80)
  fullName: string;

  @ApiProperty({ example: '3001234567' })
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'phone: solo números, de 7 a 15 dígitos' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class RepeatDto {
  @ApiProperty({ description: 'Cada cuántas semanas se repite' })
  @IsInt()
  @Min(1)
  @Max(8)
  everyWeeks: number;

  @ApiProperty({ description: 'Cuántas citas en total, contando la primera' })
  @IsInt()
  @Min(2)
  @Max(26)
  times: number;
}

export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  branchId: string;

  @ApiPropertyOptional({ example: '2026-12-01T15:00:00-05:00', description: 'Obligatorio salvo para clientes sin reserva (walkIn), que empiezan ahora' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiProperty({ type: [AppointmentLineDto], description: 'Servicios en el orden en que se prestan' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AppointmentLineDto)
  services: AppointmentLineDto[];

  @ApiPropertyOptional({ description: 'Cliente ya registrado' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ type: NewCustomerDto, description: 'Cliente nuevo. Si el teléfono ya existe se usa ese cliente.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerDto)
  customer?: NewCustomerDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Cliente sin reserva: la cita nace en atención' })
  @IsOptional()
  @IsBoolean()
  walkIn?: boolean;

  @ApiPropertyOptional({ description: 'Permite agendar fuera del horario del profesional. Nunca permite solapar citas.' })
  @IsOptional()
  @IsBoolean()
  ignoreSchedule?: boolean;

  @ApiPropertyOptional({ type: RepeatDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto;
}

export class RescheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ type: [AppointmentLineDto], description: 'Si se envía, reemplaza los servicios de la cita' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AppointmentLineDto)
  services?: AppointmentLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ignoreSchedule?: boolean;
}

export class CancelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 200)
  reason?: string;
}
