// SOLO PARA PRUEBAS. Imita lo minimo de Supabase Auth (registro, inicio de
// sesion, usuario, cierre de sesion y llaves publicas) para poder probar la
// web y la API de punta a punta sin conexion a Supabase. No es una
// integracion real: el inicio de sesion contra el proyecto verdadero se
// comprueba aparte.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54399);
const ISSUER = `http://localhost:${PORT}/auth/v1`;
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = randomUUID();
const users = new Map(); // email -> { id, email, password, user_metadata }
const refreshTokens = new Map(); // token -> email

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const publicUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at, user_metadata: u.user_metadata, app_metadata: { provider: 'email' }, created_at: u.created_at });

function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'ES256', typ: 'JWT', kid });
  const payload = encode({ iss: ISSUER, aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, iat: now, exp: now + 3600, user_metadata: user.user_metadata });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const refresh_token = randomUUID();
  refreshTokens.set(refresh_token, user.email);
  return { access_token: `${header}.${payload}.${signature}`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: publicUser(user) };
}

const emailFromBearer = (req) => {
  try {
    return JSON.parse(Buffer.from((req.headers.authorization ?? '').split('.')[1], 'base64url').toString()).email;
  } catch {
    return undefined;
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload === undefined ? '' : JSON.stringify(payload));
  };
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /auth/v1/.well-known/jwks.json') return send(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }] });
  if (route === 'POST /auth/v1/signup') {
    const email = String(body.email).toLowerCase();
    if (users.has(email)) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const user = { id: randomUUID(), email, password: body.password, user_metadata: { ...(body.data ?? {}), email_verified: true }, created_at: new Date().toISOString() };
    users.set(email, user);
    return send(200, session(user));
  }
  if (route === 'POST /auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    const user = grant === 'password' ? users.get(String(body.email).toLowerCase()) : users.get(refreshTokens.get(body.refresh_token));
    if (!user || (grant === 'password' && user.password !== body.password)) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(200, session(user));
  }
  if (route === 'GET /auth/v1/user') {
    const user = users.get(emailFromBearer(req));
    return user ? send(200, publicUser(user)) : send(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid token' });
  }
  if (route === 'POST /auth/v1/logout') return send(204);
  send(404, { msg: `ruta no simulada: ${route}` });
}).listen(PORT, () => console.log(`Supabase de pruebas en ${ISSUER}`));
