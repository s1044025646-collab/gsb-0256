import { UriError } from './errors.js';

/**
 * 按 RFC 3986 的组件字符集合进行严格校验。
 * 只接受 ASCII；控制字符、空格、反斜杠、非 ASCII 字符一律拒绝。
 * 不做任何浏览器风格的“修正”（例如把 \\ 当作 /）。
 */

const isInRange = (code: number, lo: number, hi: number): boolean =>
  code >= lo && code <= hi;

const isAlpha = (code: number): boolean =>
  isInRange(code, 0x41, 0x5a) || isInRange(code, 0x61, 0x7a);
const isDigit = (code: number): boolean => isInRange(code, 0x30, 0x39);

const isUnreserved = (code: number): boolean =>
  isAlpha(code) ||
  isDigit(code) ||
  code === 0x2d /* - */ ||
  code === 0x2e /* . */ ||
  code === 0x5f /* _ */ ||
  code === 0x7e; /* ~ */

const isSubDelim = (code: number): boolean =>
  code === 0x21 /* ! */ ||
  code === 0x24 /* $ */ ||
  code === 0x26 /* & */ ||
  code === 0x27 /* ' */ ||
  code === 0x28 /* ( */ ||
  code === 0x29 /* ) */ ||
  code === 0x2a /* * */ ||
  code === 0x2b /* + */ ||
  code === 0x2c /* , */ ||
  code === 0x3b /* ; */ ||
  code === 0x3d; /* = */

const isPctEncoded = (input: string, i: number): boolean =>
  input.charCodeAt(i) === 0x25 /* % */ &&
  isHexDigit(input.charCodeAt(i + 1)) &&
  isHexDigit(input.charCodeAt(i + 2));

const isHexDigit = (code: number): boolean =>
  isDigit(code) ||
  isInRange(code, 0x41, 0x46) ||
  isInRange(code, 0x61, 0x66);

const isPcharAllowed = (code: number): boolean =>
  isUnreserved(code) || isSubDelim(code) || code === 0x3a /* : */ || code === 0x40; /* @ */

function rejectBasic(input: string): void {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code > 0x7e) {
      if (code <= 0x7f || code === 0x7f) {
        throw new UriError('INVALID_ASCII', `仅支持 ASCII 字符，位置 ${i} 为非 ASCII 或控制字符`, i);
      }
      throw new UriError('INVALID_ASCII', `仅支持 ASCII 字符，位置 ${i} 为非 ASCII 字符`, i);
    }
    if (code < 0x20) {
      throw new UriError('CONTROL_CHARACTER', `不允许控制字符，位置 ${i}`, i);
    }
    if (code === 0x5c) {
      throw new UriError('BACKSLASH_NOT_ALLOWED', '不允许反斜杠 "\\"，通用 URI 语法中路径分隔符仅为正斜杠 "/"', i);
    }
  }
}

/**
 * 校验由 pchar / "/" 组成的路径片段（path-abempty / path-abs 等）。
 * 百分号必须是合法的 %HH 形式，否则报错。
 */
export function validatePath(input: string): void {
  rejectBasic(input);
  let i = 0;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 0x2f) {
      i++;
      continue;
    }
    if (code === 0x25) {
      if (!isPctEncoded(input, i)) {
        throw new UriError(
          'INVALID_PERCENT_ENCODING',
          `非法百分号编码：位置 ${i} 处的 "%" 后必须紧跟两个十六进制数字`,
          i,
        );
      }
      i += 3;
      continue;
    }
    if (!isPcharAllowed(code)) {
      throw new UriError('INVALID_CHARACTER', `路径中存在非法字符 "${input[i]}"（位置 ${i}）`, i);
    }
    i++;
  }
}

export function validateQueryOrFragment(input: string, kind: 'query' | 'fragment'): void {
  rejectBasic(input);
  let i = 0;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 0x2f /* / */ || code === 0x3f /* ? */ || isPcharAllowed(code)) {
      i++;
      continue;
    }
    if (code === 0x25) {
      if (!isPctEncoded(input, i)) {
        throw new UriError(
          'INVALID_PERCENT_ENCODING',
          `非法百分号编码：位置 ${i} 处的 "%" 后必须紧跟两个十六进制数字`,
          i,
        );
      }
      i += 3;
      continue;
    }
    throw new UriError('INVALID_CHARACTER', `${kind} 中存在非法字符 "${input[i]}"（位置 ${i}）`, i);
  }
}

export function validateScheme(scheme: string): void {
  if (scheme.length === 0) {
    throw new UriError('INVALID_SCHEME', 'scheme 不能为空');
  }
  if (!isAlpha(scheme.charCodeAt(0))) {
    throw new UriError('INVALID_SCHEME', `scheme 必须以字母开头，实际为 "${scheme[0]}"`, 0);
  }
  for (let i = 1; i < scheme.length; i++) {
    const code = scheme.charCodeAt(i);
    if (!isAlpha(code) && !isDigit(code) && code !== 0x2b && code !== 0x2d && code !== 0x2e) {
      throw new UriError('INVALID_SCHEME', `scheme 中存在非法字符 "${scheme[i]}"（位置 ${i}）`, i);
    }
  }
}

const isRegNameChar = (code: number): boolean =>
  isUnreserved(code) || isSubDelim(code) || code === 0x25;

export function validateAuthority(raw: string): void {
  rejectBasic(raw);
  let rest = raw;
  // userinfo
  const at = raw.indexOf('@');
  if (at !== -1) {
    const userinfo = raw.slice(0, at);
    for (let i = 0; i < userinfo.length; i++) {
      const code = userinfo.charCodeAt(i);
      if (code === 0x25) {
        if (!isPctEncoded(userinfo, i)) {
          throw new UriError('INVALID_PERCENT_ENCODING', `userinfo 中存在非法百分号编码（位置 ${i}）`, i);
        }
        i += 2;
        continue;
      }
      if (!isUnreserved(code) && !isSubDelim(code) && code !== 0x3a) {
        throw new UriError('INVALID_USERINFO', `userinfo 中存在非法字符 "${userinfo[i]}"（位置 ${i}）`, i);
      }
    }
    rest = raw.slice(at + 1);
  }

  let host: string;
  let port = '';
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close === -1) {
      throw new UriError('INVALID_IP_LITERAL', 'IP-literal 缺少闭合的 "]"');
    }
    host = rest.slice(0, close + 1);
    const after = rest.slice(close + 1);
    if (after.length > 0 && !after.startsWith(':')) {
      throw new UriError('INVALID_AUTHORITY', `authority 在 IP-literal 之后存在非法内容 "${after}"`);
    }
    port = after.startsWith(':') ? after.slice(1) : '';
  } else {
    const colon = rest.lastIndexOf(':');
    host = colon === -1 ? rest : rest.slice(0, colon);
    port = colon === -1 ? '' : rest.slice(colon + 1);
  }

  validateHost(host);
  if (port.length > 0) {
    for (let i = 0; i < port.length; i++) {
      if (!isDigit(port.charCodeAt(i))) {
        throw new UriError('INVALID_PORT', `端口必须全部为数字，非法字符 "${port[i]}"（位置 ${i}）`, i);
      }
    }
  }
}

export function validateHost(host: string): void {
  if (host.startsWith('[')) {
    if (!host.endsWith(']')) {
      throw new UriError('INVALID_IP_LITERAL', 'IP-literal 缺少闭合的 "]"');
    }
    // 仅做粗粒度 IP-literal 字符集校验，不做 DNS 查询、不做地址可达性判断
    const inner = host.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      const code = inner.charCodeAt(i);
      const ok =
        isHexDigit(code) ||
        code === 0x3a /* : */ ||
        (code === 0x2e && /^\d+\.\d+\.\d+\.\d+$/.test(inner)) ||
        (code === 0x76 /* v */ && i === 0) ||
        code === 0x2e;
      if (!ok && !isUnreserved(code) && !isSubDelim(code) && code !== 0x3a) {
        throw new UriError('INVALID_IP_LITERAL', `IP-literal 中存在非法字符 "${inner[i]}"（位置 ${i}）`, i);
      }
    }
    return;
  }
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i);
    if (code === 0x25) {
      if (!isPctEncoded(host, i)) {
        throw new UriError('INVALID_PERCENT_ENCODING', `主机名中存在非法百分号编码（位置 ${i}）`, i);
      }
      i += 2;
      continue;
    }
    if (!isRegNameChar(code)) {
      throw new UriError('INVALID_HOST', `主机名中存在非法字符 "${host[i]}"（位置 ${i}）`, i);
    }
  }
}
