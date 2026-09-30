import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { JsonStore } from './json-store.js';

function parseKey(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(text)) key = Buffer.from(text, 'hex');
  else {
    try { key = Buffer.from(text, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== 32) throw new Error('NAVER_TOKEN_KEY는 32바이트 키여야 합니다. 64자리 HEX 또는 Base64 형식을 사용해 주세요.');
  return key;
}

function validState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.version !== 1) return false;
  if (value.token !== null && (typeof value.token !== 'object' || Array.isArray(value.token))) return false;
  if (value.token) {
    for (const field of ['alg','iv','tag','data']) if (typeof value.token[field] !== 'string' || !value.token[field]) return false;
    if (value.token.alg !== 'A256GCM') return false;
  }
  return Number.isFinite(Number(value.updatedAt || 0));
}

function encryptToken(token, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(token), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { alg:'A256GCM', iv:iv.toString('base64'), tag:tag.toString('base64'), data:data.toString('base64') };
}

function decryptToken(envelope, key) {
  if (!envelope) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    const token = JSON.parse(plaintext.toString('utf8'));
    if (!token || typeof token !== 'object' || typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('invalid token payload');
    return token;
  } catch (error) {
    const wrapped = new Error('네이버 인증 토큰을 복호화하지 못했습니다. NAVER_TOKEN_KEY가 바뀌지 않았는지 확인해 주세요.');
    wrapped.code = 'ENAVER_TOKEN_DECRYPT';
    wrapped.cause = error;
    throw wrapped;
  }
}

export class NaverAuthStore extends JsonStore {
  constructor(file, keyValue) {
    super(file, { version:1, token:null, updatedAt:0 }, validState, { maxBytes:1024 * 1024 });
    this.key = parseKey(keyValue);
    if (!this.key) throw new Error('NAVER_TOKEN_KEY가 필요합니다. 네이버 OAuth 토큰 저장을 위해 32바이트 키를 설정해 주세요.');
  }
  token() { return decryptToken(this.read().token, this.key); }
  summary() {
    const state = this.read(), token = state.token ? decryptToken(state.token, this.key) : null;
    return {
      connected:Boolean(token?.accessToken),
      expiresAt:Number(token?.expiresAt || 0),
      hasRefreshToken:Boolean(token?.refreshToken),
      connectedAt:Number(token?.connectedAt || 0),
      updatedAt:Number(state.updatedAt || 0)
    };
  }
  async saveToken(input) {
    const previous = this.token();
    const accessToken = String(input?.accessToken || '').trim();
    if (!accessToken) throw new Error('네이버 access token이 없습니다.');
    const now = Date.now(), expiresIn = Math.max(0, Number(input?.expiresIn || 0));
    const token = {
      accessToken,
      refreshToken:String(input?.refreshToken || previous?.refreshToken || '').trim(),
      tokenType:String(input?.tokenType || 'bearer').toLowerCase(),
      expiresAt:expiresIn ? now + expiresIn * 1000 : Number(input?.expiresAt || previous?.expiresAt || 0),
      connectedAt:Number(previous?.connectedAt || now),
      updatedAt:now
    };
    await this.update(state => { state.token = encryptToken(token, this.key); state.updatedAt = now; });
    return this.summary();
  }
  async clear() {
    const now = Date.now();
    await this.update(state => { state.token = null; state.updatedAt = now; });
    return this.summary();
  }
}

export const __test = { parseKey, encryptToken, decryptToken, validState };
