import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';

@ApiTags('Clientes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller('customers')
export class CustomersController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiQuery({ name: 'search', required: false, description: 'Parte del nombre o del teléfono' })
  @ApiOperation({ summary: 'Buscar clientes para agendar. El CRM completo llega en la fase 5.' })
  search(@CurrentTenant() tenant: TenantContext, @Query('search') search?: string) {
    if (!['customers.read', 'customers.manage', 'appointments.manage'].some((p) => tenant.permissions.has(p))) throw new ForbiddenException('No tiene permiso para ver clientes');
    const term = (search ?? '').trim().slice(0, 60);
    return this.db.forTenant(tenant.id, (tx) =>
      tx.customer.findMany({
        where: { anonymizedAt: null, ...(term ? { OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }] } : {}) },
        orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { fullName: 'asc' }],
        take: 20,
        select: { id: true, fullName: true, phone: true, lastVisitAt: true },
      }),
    );
  }
}
