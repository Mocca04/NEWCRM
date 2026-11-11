import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { remoteJwks, SupabaseTokenVerifier, TOKEN_VERIFIER } from './auth/token-verifier';
import { APP_CONFIG, AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { CatalogController } from './modules/catalog/catalog.controller';
import { EmployeesController } from './modules/employees/employees.controller';
import { SchedulingController } from './modules/scheduling/scheduling.controller';
import { BranchesController } from './modules/branches/branches.controller';
import { HealthController } from './modules/health/health.controller';
import { MeController } from './modules/me/me.controller';
import { MembersController } from './modules/members/members.controller';
import { RolesController } from './modules/roles/roles.controller';
import { TenantsController } from './modules/tenants/tenants.controller';
import { TenantGuard } from './tenancy/tenant.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, MeController, TenantsController, BranchesController, MembersController, RolesController, CatalogController, EmployeesController, SchedulingController],
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SupabaseTokenVerifier({
          issuer: `${config.supabaseUrl}/auth/v1`,
          jwks: remoteJwks(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`),
          hmacSecret: config.supabaseJwtSecret,
        }),
    },
    // El orden importa: primero quien es, después a que empresa entra y con que permisos.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
