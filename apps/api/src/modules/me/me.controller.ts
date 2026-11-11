import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, NoTenant } from '../../common/request-context';
import { DbService } from '../../database/db.service';

@ApiTags('Sesion')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService) {}

  @NoTenant()
  @Get()
  @ApiOperation({ summary: 'Usuario autenticado y empresas a las que pertenece' })
  async me(@CurrentUser() user: AuthUser) {
    const memberships = await this.db.platform.tenantMembership.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        branchIds: true,
        tenant: { select: { id: true, tradeName: true, slug: true, status: true, logoUrl: true } },
        role: { select: { id: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } },
      },
    });
    return {
      user,
      memberships: memberships.map((m) => ({
        tenant: m.tenant,
        role: { id: m.role.id, name: m.role.name },
        permissions: m.role.permissions.map((p) => p.permission.code).sort(),
        branchIds: m.branchIds,
      })),
    };
  }
}
