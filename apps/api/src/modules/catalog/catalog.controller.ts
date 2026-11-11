import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tx } from '@newcrm/database';
import { audit } from '../../common/audit';
import { AuthUser, CurrentTenant, CurrentUser, RequirePermissions, TenantContext } from '../../common/request-context';
import { DbService } from '../../database/db.service';
import { CATALOG_TEMPLATES } from './catalog-templates';
import { CreateCategoryDto, CreateServiceDto, LoadTemplateDto, SetServicePricesDto, UpdateCategoryDto, UpdateServiceDto } from './catalog.dto';

const SERVICE_FIELDS = {
  id: true, categoryId: true, name: true, description: true, imageUrl: true, price: true, durationMinutes: true,
  prepMinutes: true, cleanupMinutes: true, depositAmount: true, resourceType: true, isPublic: true, isActive: true,
  employees: { select: { employeeId: true } },
  prices: { select: { id: true, employeeId: true, branchId: true, price: true, durationMinutes: true } },
} as const;

type ServiceRow = { employees: { employeeId: string }[] } & Record<string, unknown>;
const present = ({ employees, ...service }: ServiceRow) => ({ ...service, employeeIds: employees.map((e) => e.employeeId) });

@ApiTags('Servicios')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Controller()
export class CatalogController {
  constructor(private readonly db: DbService) {}

  // ───────── Categorías ─────────

  @Get('service-categories')
  @ApiOperation({ summary: 'Categorías de servicios' })
  async categories(@CurrentTenant() tenant: TenantContext) {
    const rows = await this.db.forTenant(tenant.id, (tx) =>
      tx.serviceCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, vertical: true, sortOrder: true, _count: { select: { services: { where: { deletedAt: null } } } } },
      }),
    );
    return rows.map(({ _count, ...category }) => ({ ...category, services: _count.services }));
  }

  @Post('service-categories')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Crear categoría' })
  createCategory(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateCategoryDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      if (await tx.serviceCategory.findFirst({ where: { name: dto.name }, select: { id: true } })) throw new ConflictException('Ya existe una categoría con ese nombre');
      return tx.serviceCategory.create({ data: { ...dto, tenantId: tenant.id }, select: { id: true, name: true, vertical: true, sortOrder: true } });
    });
  }

  @Patch('service-categories/:id')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Editar categoría' })
  updateCategory(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      if (!(await tx.serviceCategory.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Categoría no encontrada');
      if (dto.name && (await tx.serviceCategory.findFirst({ where: { name: dto.name, NOT: { id } }, select: { id: true } }))) {
        throw new ConflictException('Ya existe una categoría con ese nombre');
      }
      return tx.serviceCategory.update({ where: { id }, data: dto, select: { id: true, name: true, vertical: true, sortOrder: true } });
    });
  }

  @Delete('service-categories/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Eliminar una categoría sin servicios' })
  deleteCategory(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      if (!(await tx.serviceCategory.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Categoría no encontrada');
      // Los servicios eliminados siguen referenciando la categoría por el historial de citas.
      if (await tx.service.count({ where: { categoryId: id } })) throw new ConflictException('La categoría tiene o tuvo servicios. Muévalos a otra categoría antes de eliminarla.');
      await tx.serviceCategory.delete({ where: { id } });
    });
  }

  @Post('catalog/templates')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Cargar el catálogo inicial de un tipo de negocio. No duplica lo que ya exista.' })
  loadTemplate(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: LoadTemplateDto) {
    const template = CATALOG_TEMPLATES[dto.vertical];
    return this.db.forTenant(tenant.id, async (tx) => {
      const category =
        (await tx.serviceCategory.findFirst({ where: { name: template.category }, select: { id: true } })) ??
        (await tx.serviceCategory.create({ data: { tenantId: tenant.id, name: template.category, vertical: dto.vertical }, select: { id: true } }));
      const existing = new Set((await tx.service.findMany({ where: { categoryId: category.id, deletedAt: null }, select: { name: true } })).map((s) => s.name));
      const missing = template.services.filter(([name]) => !existing.has(name));
      const now = Date.now();
      await tx.service.createMany({
        // Un milisegundo de diferencia entre filas conserva el orden de la plantilla en los listados.
        data: missing.map(([name, durationMinutes], i) => ({ tenantId: tenant.id, categoryId: category.id, name, durationMinutes, price: 0, isPublic: false, createdAt: new Date(now + i) })),
      });
      if (missing.length) {
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'catalog.template_loaded', entityType: 'service_category', entityId: category.id, after: { vertical: dto.vertical, created: missing.length } });
      }
      return { categoryId: category.id, created: missing.length, skipped: template.services.length - missing.length };
    });
  }

  // ───────── Servicios ─────────

  @Get('services')
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiOperation({ summary: 'Servicios del negocio. Los precios van en centavos de COP.' })
  async services(@CurrentTenant() tenant: TenantContext, @Query('categoryId', new ParseUUIDPipe({ optional: true })) categoryId?: string) {
    const rows = await this.db.forTenant(tenant.id, (tx) =>
      tx.service.findMany({ where: { deletedAt: null, ...(categoryId ? { categoryId } : {}) }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }], select: SERVICE_FIELDS }),
    );
    return rows.map(present);
  }

  @Post('services')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Crear servicio' })
  createService(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() { employeeIds, ...dto }: CreateServiceDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      await this.assertCategory(tx, dto.categoryId);
      this.assertDeposit(dto.price, dto.depositAmount ?? 0);
      const service = await tx.service.create({ data: { ...dto, resourceType: dto.resourceType || null, tenantId: tenant.id }, select: { id: true } });
      if (employeeIds) await this.setEmployees(tx, tenant.id, service.id, employeeIds);
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'service.created', entityType: 'service', entityId: service.id, after: { name: dto.name, price: dto.price } });
      return present(await tx.service.findUniqueOrThrow({ where: { id: service.id }, select: SERVICE_FIELDS }));
    });
  }

  @Patch('services/:id')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Editar servicio. Las citas ya reservadas conservan el precio con el que se reservaron.' })
  updateService(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() { employeeIds, ...dto }: UpdateServiceDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const before = await tx.service.findFirst({ where: { id, deletedAt: null }, select: { price: true, depositAmount: true, name: true } });
      if (!before) throw new NotFoundException('Servicio no encontrado');
      if (dto.categoryId) await this.assertCategory(tx, dto.categoryId);
      this.assertDeposit(dto.price ?? before.price, dto.depositAmount ?? before.depositAmount);
      await tx.service.update({ where: { id }, data: { ...dto, ...(dto.resourceType === undefined ? {} : { resourceType: dto.resourceType || null }) } });
      if (employeeIds) await this.setEmployees(tx, tenant.id, id, employeeIds);
      if (dto.price !== undefined && dto.price !== before.price) {
        await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'service.price_changed', entityType: 'service', entityId: id, before: { price: before.price }, after: { price: dto.price } });
      }
      return present(await tx.service.findUniqueOrThrow({ where: { id }, select: SERVICE_FIELDS }));
    });
  }

  @Delete('services/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Eliminar servicio. Deja de ofrecerse; el historial de citas lo conserva.' })
  deleteService(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const service = await tx.service.findFirst({ where: { id, deletedAt: null }, select: { name: true } });
      if (!service) throw new NotFoundException('Servicio no encontrado');
      await tx.service.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, isPublic: false } });
      await tx.employeeService.deleteMany({ where: { serviceId: id } });
      await tx.servicePrice.deleteMany({ where: { serviceId: id } });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'service.deleted', entityType: 'service', entityId: id, before: service });
    });
  }

  @Put('services/:id/prices')
  @RequirePermissions('catalog.manage')
  @ApiOperation({ summary: 'Definir tarifas distintas por profesional y/o sucursal' })
  setPrices(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetServicePricesDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      if (!(await tx.service.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw new NotFoundException('Servicio no encontrado');
      const scopes = dto.prices.map((p) => `${p.employeeId ?? ''}|${p.branchId ?? ''}`);
      if (scopes.includes('|')) throw new BadRequestException('Cada tarifa debe indicar un profesional, una sucursal o ambos. El precio general se edita en el servicio.');
      if (new Set(scopes).size !== scopes.length) throw new BadRequestException('Hay dos tarifas para la misma combinación de profesional y sucursal');
      const employeeIds = [...new Set(dto.prices.flatMap((p) => (p.employeeId ? [p.employeeId] : [])))];
      const branchIds = [...new Set(dto.prices.flatMap((p) => (p.branchId ? [p.branchId] : [])))];
      if ((await tx.employee.count({ where: { id: { in: employeeIds }, deletedAt: null } })) !== employeeIds.length) throw new BadRequestException('Algún profesional no existe en esta empresa');
      if ((await tx.branch.count({ where: { id: { in: branchIds }, deletedAt: null } })) !== branchIds.length) throw new BadRequestException('Alguna sucursal no existe en esta empresa');
      await tx.servicePrice.deleteMany({ where: { serviceId: id } });
      await tx.servicePrice.createMany({ data: dto.prices.map((p) => ({ ...p, tenantId: tenant.id, serviceId: id })) });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'service.prices_changed', entityType: 'service', entityId: id, after: dto.prices });
      return present(await tx.service.findUniqueOrThrow({ where: { id }, select: SERVICE_FIELDS }));
    });
  }

  private async assertCategory(tx: Tx, categoryId: string): Promise<void> {
    if (!(await tx.serviceCategory.findFirst({ where: { id: categoryId }, select: { id: true } }))) throw new BadRequestException('La categoría no existe en esta empresa');
  }

  private assertDeposit(price: number, deposit: number): void {
    if (deposit > price) throw new BadRequestException('El anticipo no puede ser mayor que el precio');
  }

  private async setEmployees(tx: Tx, tenantId: string, serviceId: string, employeeIds: string[]): Promise<void> {
    if ((await tx.employee.count({ where: { id: { in: employeeIds }, deletedAt: null } })) !== employeeIds.length) throw new BadRequestException('Algún profesional no existe en esta empresa');
    await tx.employeeService.deleteMany({ where: { serviceId } });
    await tx.employeeService.createMany({ data: employeeIds.map((employeeId) => ({ tenantId, employeeId, serviceId })) });
  }
}
