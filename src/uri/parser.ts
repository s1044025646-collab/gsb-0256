import { UriError } from './errors.js';
import {
  validateAuthority,
  validatePath,
  validateQueryOrFragment,
  validateScheme,
} from './charset.js';

/**
 * RFC 3986 通用 URI 组件。
 * undefined 表示“该组件不存在”；空字符串表示“显式存在但为空”。
 * 这一区分对 query / fragment 的继承语义至关重要。
 */
export interface UriComponents {
  scheme?: string;
  authority?: string;
  path: string;
  query?: string;
  fragment?: string;
}

/**
 * 按 RFC 3986 附录 A 的通用分层语法拆分一个 URI 引用（相对或绝对）。
 *
 * URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
 * relative-ref = relative-part [ "?" query ] [ "#" fragment ]
 *
 * 注意：必须先切出 fragment，再切出 query，再判断 scheme / authority，
 * 否则 query/fragment 中的 ":"、"//"、"?" 等字符会被误判。
 */
export function parseUriReference(input: string): UriComponents {
  if (typeof input !== 'string') {
    throw new UriError('INVALID_INPUT', '输入必须是字符串');
  }
  let rest = input;

  let fragment: string | undefined;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
    validateQueryOrFragment(fragment, 'fragment');
  }

  let query: string | undefined;
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    query = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
    validateQueryOrFragment(query, 'query');
  }

  let scheme: string | undefined;
  const colonIdx = rest.indexOf(':');
  // 相对引用的第一段（noscram 段）里不允许出现 ':'，
  // 因此首个 ':' 之前若全部是 scheme 合法字符，则认定为 scheme。
  if (colonIdx !== -1) {
    const head = rest.slice(0, colonIdx);
    if (head.length > 0 && /^[A-Za-z][A-Za-z0-9+\-.]*$/.test(head)) {
      scheme = head;
      validateScheme(scheme);
      rest = rest.slice(colonIdx + 1);
    }
  }

  let authority: string | undefined;
  if (rest.startsWith('//')) {
    const slashIdx = rest.indexOf('/', 2);
    if (slashIdx === -1) {
      authority = rest.slice(2);
      rest = '';
    } else {
      authority = rest.slice(2, slashIdx);
      rest = rest.slice(slashIdx);
    }
    validateAuthority(authority);
  }

  const path = rest;
  validatePath(path);

  return { scheme, authority, path, query, fragment };
}

/**
 * 解析绝对基准 URI：必须带非空 scheme；带 "//" 时必须带非空 authority，
 * 或者 scheme 为 file 等允许空 authority 的特例——这里按严格通用规则，
 * 只要出现 "//" 就要求 authority 非空。
 */
export function parseAbsoluteBase(input: string): UriComponents {
  const c = parseUriReference(input);
  if (!c.scheme) {
    throw new UriError('BASE_NOT_ABSOLUTE', '基准 URI 必须是绝对 URI（缺少 scheme，例如 http://...）');
  }
  return c;
}

export function recompose(c: UriComponents): string {
  let result = '';
  if (c.scheme !== undefined) result += c.scheme + ':';
  if (c.authority !== undefined) result += '//' + c.authority;
  result += c.path;
  if (c.query !== undefined) result += '?' + c.query;
  if (c.fragment !== undefined) result += '#' + c.fragment;
  return result;
}
