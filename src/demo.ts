import { resolveReference, ALGORITHM_VERSION } from './uri/resolve.js';

interface Case {
  base: string;
  ref: string;
  expected?: string;
  note?: string;
}

const BASE = 'http://a/b/c/d;p?q';

const requiredCases: Case[] = [
  { base: BASE, ref: 'g', expected: 'http://a/b/c/g', note: '普通相对路径：与基准所在目录 /b/c/ 合并' },
  { base: BASE, ref: '../g', expected: 'http://a/b/g', note: '单层 ..：从 /b/c/ 上溯到 /b/' },
  { base: BASE, ref: '/g', expected: 'http://a/g', note: '绝对路径：直接替换基准路径' },
  { base: BASE, ref: '//g', expected: 'http://g', note: '仅带 authority：替换主机，路径为空' },
  { base: BASE, ref: '?y', expected: 'http://a/b/c/d;p?y', note: '仅 query：路径继承，基准 query 被替换' },
  { base: BASE, ref: '#s', expected: 'http://a/b/c/d;p?q#s', note: '仅 fragment：路径与 query 继承，fragment 替换' },
  { base: BASE, ref: '', expected: 'http://a/b/c/d;p?q', note: '空引用：继承路径与 query，但不继承基准 fragment' },
];

const rfcNormal: Case[] = [
  { base: BASE, ref: './g', expected: 'http://a/b/c/g' },
  { base: BASE, ref: 'g/', expected: 'http://a/b/c/g/' },
  { base: BASE, ref: '/g', expected: 'http://a/g' },
  { base: BASE, ref: '//g', expected: 'http://g' },
  { base: BASE, ref: '?y', expected: 'http://a/b/c/d;p?y' },
  { base: BASE, ref: 'g?y', expected: 'http://a/b/c/g?y' },
  { base: BASE, ref: '#s', expected: 'http://a/b/c/d;p?q#s' },
  { base: BASE, ref: 'g#s', expected: 'http://a/b/c/g#s' },
  { base: BASE, ref: 'g?y#s', expected: 'http://a/b/c/g?y#s' },
  { base: BASE, ref: ';x', expected: 'http://a/b/c/;x' },
  { base: BASE, ref: 'g;x', expected: 'http://a/b/c/g;x' },
  { base: BASE, ref: 'g;x?y#s', expected: 'http://a/b/c/g;x?y#s' },
  { base: BASE, ref: '.', expected: 'http://a/b/c/' },
  { base: BASE, ref: './', expected: 'http://a/b/c/' },
  { base: BASE, ref: '..', expected: 'http://a/b/' },
  { base: BASE, ref: '../', expected: 'http://a/b/' },
  { base: BASE, ref: '../g', expected: 'http://a/b/g' },
  { base: BASE, ref: '../..', expected: 'http://a/' },
  { base: BASE, ref: '../../', expected: 'http://a/' },
  { base: BASE, ref: '../..g', expected: 'http://a/b/..g', note: '..g 是普通段名，不是点段' },
];

const rfcAbnormal: Case[] = [
  { base: BASE, ref: '../../../g', expected: 'http://a/g', note: '多层 ..：到根后不再继续上溯' },
  { base: BASE, ref: '../../../../g', expected: 'http://a/g', note: '超出根的 .. 全部丢弃，不产生虚构上级' },
  { base: BASE, ref: '/../../g', expected: 'http://a/g' },
  { base: BASE, ref: '/./g', expected: 'http://a/g' },
  { base: BASE, ref: 'g.', expected: 'http://a/b/c/g.' },
  { base: BASE, ref: '.g', expected: 'http://a/b/c/.g' },
  { base: BASE, ref: 'g..', expected: 'http://a/b/c/g..' },
  { base: BASE, ref: '..g', expected: 'http://a/b/c/..g' },
  { base: BASE, ref: './../g', expected: 'http://a/b/g' },
  { base: BASE, ref: './g/.', expected: 'http://a/b/c/g/' },
  { base: BASE, ref: 'g/./h', expected: 'http://a/b/c/g/h' },
  { base: BASE, ref: 'g/../h', expected: 'http://a/b/c/h' },
  { base: BASE, ref: 'g;x=1/./y', expected: 'http://a/b/c/g;x=1/y' },
  { base: BASE, ref: 'g;x=1/../y', expected: 'http://a/b/c/y' },
  { base: BASE, ref: 'http:g', expected: 'http:g', note: '同 scheme 无 authority：丢弃主机（异常示例）' },
  { base: BASE, ref: 'http:', expected: 'http:', note: '同 scheme 空路径空 query：不继承基准' },
];

const edgeCases: Case[] = [
  { base: BASE, ref: 'g?', expected: 'http://a/b/c/g?', note: '显式空 query：保留 "?"' },
  { base: BASE, ref: 'g#', expected: 'http://a/b/c/g#', note: '显式空 fragment：保留 "#"' },
  { base: BASE, ref: 'g?a/b/c', expected: 'http://a/b/c/g?a/b/c', note: 'query 中的斜杠原样保留，不参与路径处理' },
  { base: BASE, ref: 'g#h/i/../j', expected: 'http://a/b/c/g#h/i/../j', note: 'fragment 中的 .. 原样保留' },
  { base: 'http://a', ref: 'g', expected: 'http://a/g', note: '基准有 authority 但路径为空：合并为 /g' },
  { base: 'http://a/', ref: 'g', expected: 'http://a/g' },
  { base: 'http://a/b', ref: '', expected: 'http://a/b' },
  { base: 'http://a/b', ref: '?', expected: 'http://a/b?', note: '空 query 与无 query 不同' },
  { base: 'http://a/b#frag', ref: '', expected: 'http://a/b', note: '空引用不继承基准 fragment' },
  { base: 'http://a/b/c//d', ref: '../g', expected: 'http://a/b/c/g', note: '重复斜杠按普通空段处理（不做规范化折叠）' },
  { base: BASE, ref: 'a/%2e%2e/b', expected: 'http://a/b/c/a/%2e%2e/b', note: '百分号编码的点：不解码、不当作点段' },
  { base: BASE, ref: 'a/%2F..', expected: 'http://a/b/c/a/%2F..', note: '百分号编码的斜杠：不视为路径分隔符' },
  { base: BASE, ref: '%2e%2e/g', expected: 'http://a/b/c/%2e%2e/g', note: '编码后的 ".." 是普通段名' },
  { base: BASE, ref: '..%2fg', expected: 'http://a/b/c/..%2fg', note: '整段名含 %2f，不是 ".." 段，不上溯' },
];

function runSection(title: string, cases: Case[]): number {
  console.log(`\n=== ${title} ===`);
  let failures = 0;
  for (const c of cases) {
    const report = resolveReference(c.base, c.ref);
    const got = report.resolvedUri;
    const pass = c.expected === undefined || got === c.expected;
    if (!pass) failures++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${JSON.stringify(c.ref)}  =>  ${got}` +
        (c.expected !== undefined && !pass ? `  (期望 ${c.expected})` : '') +
        (c.note ? `\n       └ ${c.note}` : ''),
    );
  }
  return failures;
}

function showDetailedSteps(): void {
  console.log('\n=== 逐步解释示例：base=' + BASE + '  ref="../g" ===');
  const report = resolveReference(BASE, '../g');
  console.log(JSON.stringify({
    baseComponents: report.baseComponents,
    referenceComponents: report.referenceComponents,
    mergedPath: report.mergedPath,
    dotRemovedPath: report.dotRemovedPath,
    targetComponents: report.targetComponents,
    inherit: report.inherit,
    resolvedUri: report.resolvedUri,
  }, null, 2));
  console.log('步骤：');
  report.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

function showErrors(): void {
  console.log('\n=== 错误输入示例 ===');
  const bad: Array<{ base: string; ref: string }> = [
    { base: 'not-an-absolute-uri', ref: 'g' },
    { base: BASE, ref: 'a/%zz' },
    { base: BASE, ref: 'a\\b' },
    { base: BASE, ref: 'a/%2' },
  ];
  for (const item of bad) {
    try {
      resolveReference(item.base, item.ref);
      console.log(`意外成功：${JSON.stringify(item)}`);
    } catch (err) {
      const e = err as { code?: string; message?: string; position?: number };
      console.log(`ERROR ref=${JSON.stringify(item.ref)} code=${e.code} position=${e.position ?? '-'} msg=${e.message}`);
    }
  }
}

console.log(`算法版本：${ALGORITHM_VERSION}`);
let totalFailures = 0;
totalFailures += runSection('题目要求的 7 个演示', requiredCases);
totalFailures += runSection('RFC 5.4.1 正常示例（固定预期）', rfcNormal);
totalFailures += runSection('RFC 5.4.2 异常示例（固定预期）', rfcAbnormal);
totalFailures += runSection('边界：空 query/空 fragment/重复斜杠/空路径主机/百分号点段', edgeCases);
showDetailedSteps();
showErrors();
console.log(`\n${totalFailures === 0 ? '全部固定预期通过 ✓' : `有 ${totalFailures} 个失败 ✗`}`);
process.exit(totalFailures === 0 ? 0 : 1);
