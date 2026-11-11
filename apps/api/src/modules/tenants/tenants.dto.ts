import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({ example: 'Barbería El Patio' })
  @IsString()
  @Length(2, 80)
  tradeName: string;

  @ApiProperty({ example: 'barberia-el-patio', description: 'Dirección publica: plataforma.com/<slug>' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug: solo minúsculas, números y guiones' })
  @Length(3, 40)
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

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

  @ApiPropertyOptional({ enum: ['inicial', 'negocio', 'premium', 'empresarial'], default: 'negocio' })
  @IsOptional()
  @IsIn(['inicial', 'negocio', 'premium', 'empresarial'])
  planCode?: string;
}

export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['slug', 'planCode'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[0-9]{6,12}(-[0-9])?$/, { message: 'nit: solo números, con dígito de verificación opcional' })
  nit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  coverUrl?: string;

  @ApiPropertyOptional({ description: 'Redes sociales: { instagram, facebook, tiktok, whatsapp }' })
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
