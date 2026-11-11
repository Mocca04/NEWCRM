import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString, Length } from 'class-validator';

export class SetPermissionsDto {
  @ApiProperty({ example: ['appointments.read', 'customers.read'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes: string[];
}

export class CreateRoleDto extends SetPermissionsDto {
  @ApiProperty({ example: 'Cajero' })
  @IsString()
  @Length(2, 40)
  name: string;
}
