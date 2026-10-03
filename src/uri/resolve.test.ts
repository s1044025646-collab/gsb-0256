import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReference, removeDotSegments } from './resolve.js';
import { UriError } from './errors.js';

const BASE = 'http://a/b/c/d;p?q';

function r(ref: string, base: string = BASE): string {
  return resolveReference(base, ref).resolvedUri;
}

test('题目要求的 7 个核心演示', () => {
  assert.equal(r('g'), 'http://a/b/c/g');
  assert.equal(r('../g'), 'http://a/b/g');
  assert.equal(r('/g'), 'http://a/g');
  assert.equal(r('//g'), 'http://g');
  assert.equal(r('?y'), 'http://a/b/c/d;p?y');
  assert.equal(r('#s'), 'http://a/b/c/d;p?q#s');
  assert.equal(r(''), 'http://a/b/c/d;p?q');
});

test('RFC 5.4.1 正常示例', () => {
  const cases: Array<[string, string]> = [
    ['g:h', 'g:h'],
    ['g', 'http://a/b/c/g'],
    ['./g', 'http://a/b/c/g'],
    ['g/', 'http://a/b/c/g/'],
    ['/g', 'http://a/g'],
    ['//g', 'http://g'],
    ['?y', 'http://a/b/c/d;p?y'],
    ['g?y', 'http://a/b/c/g?y'],
    ['#s', 'http://a/b/c/d;p?q#s'],
    ['g#s', 'http://a/b/c/g#s'],
    ['g?y#s', 'http://a/b/c/g?y#s'],
    [';x', 'http://a/b/c/;x'],
    ['g;x', 'http://a/b/c/g;x'],
    ['g;x?y#s', 'http://a/b/c/g;x?y#s'],
    ['', 'http://a/b/c/d;p?q'],
    ['.', 'http://a/b/c/'],
    ['./', 'http://a/b/c/'],
    ['..', 'http://a/b/'],
    ['../', 'http://a/b/'],
    ['../g', 'http://a/b/g'],
    ['../..', 'http://a/'],
    ['../../', 'http://a/'],
    ['../../g', 'http://a/g'],
  ];
  for (const [ref, expected] of cases) {
    assert.equal(r(ref), expected, `ref=${JSON.stringify(ref)}`);
  }
});

test('RFC 5.4.2 异常示例', () => {
  const cases: Array<[string, string]> = [
    ['../../../g', 'http://a/g'],
    ['../../../../g', 'http://a/g'],
    ['/../../g', 'http://a/g'],
    ['/./g', 'http://a/g'],
    ['g.', 'http://a/b/c/g.'],
    ['.g', 'http://a/b/c/.g'],
    ['g..', 'http://a/b/c/g..'],
    ['..g', 'http://a/b/c/..g'],
    ['./../g', 'http://a/b/g'],
    ['./g/.', 'http://a/b/c/g/'],
    ['./g/../h', 'http://a/b/c/h'],
    ['g;x=1/./y', 'http://a/b/c/g;x=1/y'],
    ['g;x=1/../y', 'http://a/b/c/y'],
    ['g?y/./x', 'http://a/b/c/g?y/./x'],
    ['g?y/../x', 'http://a/b/c/g?y/../x'],
    ['g#s/./x', 'http://a/b/c/g#s/./x'],
    ['g#s/../x', 'http://a/b/c/g#s/../x'],
    ['http:g', 'http:g'],
    ['http:', 'http:'],
  ];
  for (const [ref, expected] of cases) {
    assert.equal(r(ref), expected, `ref=${JSON.stringify(ref)}`);
  }
});

test('多层 .. 到根后不产生虚构上级', () => {
  assert.equal(removeDotSegments('/../../../a').result, '/a');
  assert.equal(removeDotSegments('../../../../g').result, 'g');
  assert.equal(r('../../../../../../x'), 'http://a/x');
});

test('尾部 /. 与 /..', () => {
  assert.equal(removeDotSegments('/a/b/.').result, '/a/b/');
  assert.equal(removeDotSegments('/a/b/..').result, '/a/');
  assert.equal(r('g/.'), 'http://a/b/c/g/');
  assert.equal(r('g/..'), 'http://a/b/c/');
});

test('空 query / 空 fragment 与不存在的区分', () => {
  assert.equal(r('g?'), 'http://a/b/c/g?');
  assert.equal(r('g#'), 'http://a/b/c/g#');
  assert.equal(r('g?#'), 'http://a/b/c/g?#');
  const rep = resolveReference(BASE, 'g?');
  assert.equal(rep.targetComponents.query, '');
  assert.equal(rep.targetComponents.fragment, undefined);
  const rep2 = resolveReference(BASE, 'g#');
  assert.equal(rep2.targetComponents.fragment, '');
  assert.equal(rep2.targetComponents.query, undefined);
});

test('query 与 fragment 中的斜杠和点段不被处理', () => {
  assert.equal(r('g?a/../b'), 'http://a/b/c/g?a/../b');
  assert.equal(r('g#a/../b'), 'http://a/b/c/g#a/../b');
  assert.equal(r('g?a/b#c/d'), 'http://a/b/c/g?a/b#c/d');
});

test('重复斜杠保留（不做折叠）', () => {
  assert.equal(r('a//b'), 'http://a/b/c/a//b');
  assert.equal(r('a//../b'), 'http://a/b/c/a/b');
});

test('带 authority 但空路径的基准：相对路径前置 /', () => {
  assert.equal(r('g', 'http://a'), 'http://a/g');
  assert.equal(r('../g', 'http://a'), 'http://a/g');
});

test('百分号编码的点与斜杠不被当作点段或分隔符', () => {
  assert.equal(r('%2e%2e/g'), 'http://a/b/c/%2e%2e/g');
  assert.equal(r('a/%2e%2e/b'), 'http://a/b/c/a/%2e%2e/b');
  assert.equal(r('a/%2F../b'), 'http://a/b/c/a/%2F../b');
  assert.equal(r('a/..%2fb'), 'http://a/b/c/a/..%2fb');
});

test('fragment 绝不从基准继承', () => {
  assert.equal(r('', 'http://a/b/c#frag'), 'http://a/b/c');
  assert.equal(r('#x', 'http://a/b/c#frag'), 'http://a/b/c#x');
});

test('带端口与 userinfo 的 authority', () => {
  assert.equal(r('//u@h:8080/x', BASE), 'http://u@h:8080/x');
  assert.equal(r('g', 'https://user@host:9000/a/b'), 'https://user@host:9000/a/g');
});

test('报告包含原始组件、继承来源、合并路径与步骤', () => {
  const rep = resolveReference(BASE, '../g');
  assert.equal(rep.mergedPath, '/b/c/../g');
  assert.equal(rep.dotRemovedPath, '/b/g');
  assert.equal(rep.inherit.scheme, 'base');
  assert.equal(rep.inherit.authority, 'base');
  assert.equal(rep.inherit.path, 'merged');
  assert.equal(rep.inherit.fragment, 'none');
  assert.ok(rep.steps.length >= 3);
});

test('非法输入报错且不静默替换', () => {
  assert.throws(() => r('a/%zz'), (e: unknown) => e instanceof UriError && e.code === 'INVALID_PERCENT_ENCODING');
  assert.throws(() => r('a/%2'), (e: unknown) => e instanceof UriError && e.code === 'INVALID_PERCENT_ENCODING');
  assert.throws(() => r('a\\b'), (e: unknown) => e instanceof UriError && e.code === 'BACKSLASH_NOT_ALLOWED');
  assert.throws(() => r('a b'), (e: unknown) => e instanceof UriError && e.code === 'INVALID_CHARACTER');
  assert.throws(() => r('a\u007fb'), (e: unknown) => e instanceof UriError && e.code === 'INVALID_ASCII');
  assert.throws(() => r('a\u00e9b'), (e: unknown) => e instanceof UriError && e.code === 'INVALID_ASCII');
  assert.throws(() => resolveReference('relative/base', 'g'), (e: unknown) => e instanceof UriError && e.code === 'BASE_NOT_ABSOLUTE');
});

test('相同输入稳定输出', () => {
  for (const ref of ['../g', '//h/a/./b?x#y', '']) {
    assert.equal(resolveReference(BASE, ref).resolvedUri, resolveReference(BASE, ref).resolvedUri);
  }
});
