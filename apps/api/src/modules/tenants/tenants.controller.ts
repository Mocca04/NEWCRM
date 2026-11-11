import { Body, ConflictException, Controller, Get, Inject, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { audit } from '../../common/audit';
import { AuthUser, CurrentTenant, CurrentUser, NoTenant, RequirePermissions, TenantContext } from '../../common/request-context';
import { APP_CONFIG, AppConfig } from '../../config';
import { DbService } from '../../database/db.service';
import { RESERVED_SLUGS, ROLE_TEMPLATES, OWNER_ROLE } from '../../tenancy/role-templates';
import { CreateTenantDto, UpdateTenantDto } from './tenants.dto';

const TENANT_FIELDS = {
  id: true, tradeName: true, legalName: true, nit: true, slug: true, email: true, phone: true, city: true,
  address: true, logoUrl: true, coverUrl: true, socialLinks: true, businessHours: true, status: true, createdAt: true,
} as const;

@ApiTags('Empresa')
@ApiBearerAuth()
@Controller()
export class TenantsController {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @NoTenant()
  @Post('tenants')
  @ApiOperation({ summary: 'Registrar un establecimiento. Quien lo crea queda como Propietario.' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    if (RESERVED_SLUGS.has(dto.slug)) throw new ConflictException('Esa dirección no está disponible');
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + this.config.defaultTrialDays * 86_400_000);

    // Operacion de plataforma: la empresa aún no existe, no hay contexto RLS.
    return this.db.platform.$transaction(async (tx) => {
      if (await tx.tenant.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
        throw new ConflictException('Esa dirección ya está en uso');
      }
      const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: dto.planCode ?? 'negocio' } });
      const tenant = await tx.tenant.create({
        data: { tradeName: dto.tradeName, slug: dto.slug, email: dto.email ?? user.email, phone: dto.phone, city: dto.city, address: dto.address, ownerName: user.fullName },
        select: TENANT_FIELDS,
      });

      const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
      let ownerRoleId = '';
      for (const template of ROLE_TEMPLATES) {
        const granted = permissions.filter((p) =>
          template.permissions === 'ALL' ? !template.except?.includes(p.code) : template.permissions.includes(p.code),
        );
        const role = await tx.role.create({ data: { tenantId: tenant.id, name: template.name, isSystem: true } });
        await tx.rolePermission.createMany({ data: granted.map((p) => ({ tenantId: tenant.id, roleId: role.id, permissionId: p.id })) });
        if (template.name === OWNER_ROLE) ownerRoleId = role.id;
      }

      await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, roleId: ownerRoleId } });
      await tx.branch.create({ data: { tenantId: tenant.id, name: 'Principal', city: dto.city, address: dto.address, phone: dto.phone } });
      await tx.subscription.create({
        data: { tenantId: tenant.id, planId: plan.id, billingCycle: 'MONTHLY', status: 'TRIALING', trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt },
      });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'tenant.created', entityType: 'tenant', entityId: tenant.id, after: { slug: tenant.slug, plan: plan.code } });
      return tenant;
    });
  }

  @Get('tenant')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiOperation({ summary: 'Datos de la empresa activa' })
  get(@CurrentTenant() tenant: TenantContext) {
    return this.db.forTenant(tenant.id, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: TENANT_FIELDS }));
  }

  @Patch('tenant')
  @RequirePermissions('tenant.manage')
  @ApiHeader({ name: 'X-Tenant-Id', required: true })
  @ApiOperation({ summary: 'Editar datos de la empresa activa' })
  update(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantContext, @Body() dto: UpdateTenantDto) {
    return this.db.forTenant(tenant.id, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: TENANT_FIELDS });
      const after = await tx.tenant.update({ where: { id: tenant.id }, data: dto, select: TENANT_FIELDS });
      await audit(tx, { tenantId: tenant.id, actorUserId: user.id, action: 'tenant.updated', entityType: 'tenant', entityId: tenant.id, before, after });
      return after;
    });
  }
}
