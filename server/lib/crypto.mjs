import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const sha = value => createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Formato preservado da versão 1.1.0 (`salt:chave` em hexadecimal, scrypt padrão),
// para que as senhas já cadastradas continuem válidas após a atualização.
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordValid(password, hash) {
  try {
    const [salt, key] = hash.split(':');
    return safeEqual(scryptSync(password, salt, 64).toString('hex'), key);
  } catch {
    return false;
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
