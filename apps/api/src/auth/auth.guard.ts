import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRequest, IS_PUBLIC } from '../common/request-context';
import { DbService } from '../database/db.service';
import { InvalidTokenError, TOKEN_VERIFIER, TokenClaims, TokenVerifier } from './token-verifier';

export const PENDING_PREFIX = 'pending:';

/** Autentica cada petición con el token de Supabase y resuelve el usuario interno. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token de sesión');

    let claims: TokenClaims;
    try {
      claims = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw new UnauthorizedException('Sesión inválida o vencida');
      throw error;
    }
    request.user = await this.resolveUser(claims);
    return true;
  }

  private async resolveUser(claims: TokenClaims) {
    const users = this.db.platform.user;
    const select = { id: true, email: true, fullName: true, isPlatformAdmin: true } as const;
    const existing = await users.findUnique({ where: { authProviderId: claims.sub }, select });
    if (existing) return existing;

    if (!claims.email) throw new UnauthorizedException('La sesión no trae correo');
    const byEmail = await users.findUnique({ where: { email: claims.email }, select: { id: true, authProviderId: true } });
    if (byEmail) {
      // Usuario invitado que inicia sesión por primera vez: solo se enlaza si
      // el proveedor confirma que el correo es suyo.
      if (!byEmail.authProviderId.startsWith(PENDING_PREFIX) || !claims.emailVerified) {
        throw new ForbiddenException('Confirme su correo para acceder a esta cuenta');
      }
      return users.update({ where: { id: byEmail.id }, data: { authProviderId: claims.sub, ...(claims.fullName ? { fullName: claims.fullName } : {}) }, select });
    }
    return users.create({
      data: { authProviderId: claims.sub, email: claims.email, fullName: claims.fullName ?? claims.email.split('@')[0] },
      select,
    });
  }
}
