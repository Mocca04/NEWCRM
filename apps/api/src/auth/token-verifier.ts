import { createHmac, createPublicKey, JsonWebKey, timingSafeEqual, verify } from 'node:crypto';

export interface TokenClaims {
  sub: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
}

export class InvalidTokenError extends Error {}

export type Jwk = JsonWebKey & { kid?: string; alg?: string };
export type JwksProvider = () => Promise<Jwk[]>;

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  verify(token: string): Promise<TokenClaims>;
}

const decode = (part: string): Record<string, any> => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidTokenError('token ilegible');
  }
};

/** Descarga y guarda en memoria las llaves publicas del proyecto de Supabase. */
export function remoteJwks(url: string, ttlMs = 10 * 60 * 1000): JwksProvider {
  let cache: { keys: Jwk[]; at: number } | undefined;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.keys;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudieron obtener las llaves de Supabase (${response.status})`);
    const body = (await response.json()) as { keys?: Jwk[] };
    cache = { keys: body.keys ?? [], at: Date.now() };
    return cache.keys;
  };
}

/**
 * Valida los tokens de sesión emitidos por Supabase Auth.
 * Firma asimetrica (ES256 / RS256) contra las llaves publicas del proyecto;
 * HS256 solo si se configura el secreto de un proyecto antiguo.
 */
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(
    private readonly options: { issuer: string; jwks: JwksProvider; hmacSecret?: string; audience?: string; now?: () => number },
  ) {}

  async verify(token: string): Promise<TokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidTokenError('formato de token invalido');
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decode(headerPart);
    const payload = decode(payloadPart);
    const data = Buffer.from(`${headerPart}.${payloadPart}`);
    const signature = Buffer.from(signaturePart, 'base64url');

    if (!(await this.signatureIsValid(header, data, signature))) throw new InvalidTokenError('firma inválida');

    const now = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) throw new InvalidTokenError('token vencido');
    if (typeof payload.nbf === 'number' && payload.nbf > now + 30) throw new InvalidTokenError('token aún no vigente');
    if (payload.iss !== this.options.issuer) throw new InvalidTokenError('emisor no reconocido');
    const audience = this.options.audience ?? 'authenticated';
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(audience)) throw new InvalidTokenError('audiencia no reconocida');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new InvalidTokenError('token sin usuario');

    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined,
      emailVerified: meta.email_verified === true,
      fullName: typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : undefined,
    };
  }

  private async signatureIsValid(header: Record<string, any>, data: Buffer, signature: Buffer): Promise<boolean> {
    if (header.alg === 'HS256') {
      if (!this.options.hmacSecret) return false;
      const expected = createHmac('sha256', this.options.hmacSecret).update(data).digest();
      return expected.length === signature.length && timingSafeEqual(expected, signature);
    }
    if (header.alg !== 'ES256' && header.alg !== 'RS256') return false;
    const keys = await this.options.jwks();
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) return false;
    if ((header.alg === 'ES256') !== (jwk.kty === 'EC')) return false;
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      return verify('sha256', data, header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, signature);
    } catch {
      return false;
    }
  }
}
