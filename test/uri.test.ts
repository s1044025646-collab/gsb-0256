import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolve,
  removeDotSegments,
  mergePaths,
  parseComponents,
  UriError,
} from "../dist/uri.js";

const BASE = "http://a/b/c/d;p?q";

// RFC 3986 5.4.1 正常示例（固定预期，来自规范文本）
const normal: Array<[string, string]> = [
  ["g:h", "g:h"],
  ["g", "http://a/b/c/g"],
  ["./g", "http://a/b/c/g"],
  ["g/", "http://a/b/c/g/"],
  ["/g", "http://a/g"],
  ["//g", "http://g"],
  ["?y", "http://a/b/c/d;p?y"],
  ["g?y", "http://a/b/c/g?y"],
  ["#s", "http://a/b/c/d;p?q#s"],
  ["g#s", "http://a/b/c/g#s"],
  ["g?y#s", "http://a/b/c/g?y#s"],
  [";x", "http://a/b/c/;x"],
  ["g;x", "http://a/b/c/g;x"],
  ["g;x?y#s", "http://a/b/c/g;x?y#s"],
  ["", "http://a/b/c/d;p?q"],
  [".", "http://a/b/c/"],
  ["./", "http://a/b/c/"],
  ["..", "http://a/b/"],
  ["../", "http://a/b/"],
  ["../g", "http://a/b/g"],
  ["../..", "http://a/"],
  ["../../", "http://a/"],
  ["../../g", "http://a/g"],
];

// RFC 3986 5.4.2 异常示例
const abnormal: Array<[string, string]> = [
  ["../../../g", "http://a/g"],
  ["../../../../g", "http://a/g"],
  ["/./g", "http://a/g"],
  ["/../g", "http://a/g"],
  ["g.", "http://a/b/c/g."],
  [".g", "http://a/b/c/.g"],
  ["g..", "http://a/b/c/g.."],
  ["..g", "http://a/b/c/..g"],
  ["./../g", "http://a/b/g"],
  ["./g/.", "http://a/b/c/g/"],
  ["g/./h", "http://a/b/c/g/h"],
  ["g/../h", "http://a/b/c/h"],
  ["g;x=1/./y", "http://a/b/c/g;x=1/y"],
  ["g;x=1/../y", "http://a/b/c/y"],
  ["http:g", "http:g"],
];

for (const [ref, expected] of [...normal, ...abnormal]) {
  test(`resolve ${JSON.stringify(ref)} => ${expected}`, () => {
    assert.equal(resolve(BASE, ref).uri, expected);
  });
}

test("query/fragment 中的点段与斜杠不处理", () => {
  assert.equal(resolve(BASE, "g?y/./z/../w").uri, "http://a/b/c/g?y/./z/../w");
  assert.equal(resolve(BASE, "g#s/./t").uri, "http://a/b/c/g#s/./t");
  assert.equal(resolve(BASE, "g?a/b//c").uri, "http://a/b/c/g?a/b//c");
});

test("百分号编码的点段不消除", () => {
  assert.equal(resolve(BASE, "%2e%2e/g").uri, "http://a/b/c/%2e%2e/g");
  assert.equal(resolve(BASE, "../%2E/g").uri, "http://a/b/%2E/g");
  assert.equal(resolve(BASE, "a%2Fb").uri, "http://a/b/c/a%2Fb");
});

test("空 query 与无 query 区分", () => {
  const r1 = resolve(BASE, "?");
  assert.equal(r1.uri, "http://a/b/c/d;p?");
  assert.equal(r1.result.query, "");
  const r2 = resolve(BASE, "");
  assert.equal(r2.result.query, "q");
  assert.equal(r2.uri, "http://a/b/c/d;p?q");
  const r3 = resolve(BASE, "g?");
  assert.equal(r3.uri, "http://a/b/c/g?");
});

test("空 fragment 与无 fragment 区分", () => {
  const r1 = resolve(BASE, "#");
  assert.equal(r1.uri, "http://a/b/c/d;p?q#");
  assert.equal(r1.result.fragment, "");
  const r2 = resolve(BASE, "");
  assert.equal(r2.result.fragment, undefined);
});

test("空引用继承路径与查询但不继承片段", () => {
  const r = resolve("http://a/b/c/d;p?q#frag", "");
  assert.equal(r.uri, "http://a/b/c/d;p?q");
});

test("尾部 /. 与 /..", () => {
  assert.equal(resolve(BASE, "g/.").uri, "http://a/b/c/g/");
  assert.equal(resolve(BASE, "g/..").uri, "http://a/b/c/");
  assert.equal(resolve(BASE, "/.").uri, "http://a/");
  assert.equal(resolve(BASE, "/..").uri, "http://a/");
});

test("多层 .. 到根后不产生虚构上级", () => {
  assert.equal(resolve(BASE, "../../../../../../g").uri, "http://a/g");
  assert.equal(removeDotSegments("/../../x"), "/x");
});

test("重复斜杠保留", () => {
  assert.equal(resolve(BASE, "g//h").uri, "http://a/b/c/g//h");
  assert.equal(resolve(BASE, "//x//y").uri, "http://x//y");
});

test("基准有 authority 但路径为空", () => {
  assert.equal(resolve("http://a", "g").uri, "http://a/g");
  assert.equal(resolve("http://a", "").uri, "http://a");
  assert.equal(mergePaths(parseComponents("http://a", "t"), "g"), "/g");
});

test("带 authority 的引用替换主机部分", () => {
  const r = resolve(BASE, "//g/h?x#f");
  assert.equal(r.uri, "http://g/h?x#f");
  assert.equal(r.steps.authority.source, "reference");
});

test("报告包含继承来源与合并路径", () => {
  const r = resolve(BASE, "../g");
  assert.equal(r.steps.mergedPath, "/b/c/../g");
  assert.equal(r.steps.dotSegmentsRemovedPath, "/b/g");
  assert.equal(r.steps.scheme.source, "base");
  assert.equal(r.steps.authority.value, "a");
  const r2 = resolve(BASE, "?y");
  assert.equal(r2.steps.query.source, "reference");
  assert.equal(r2.steps.pathSource, "inherited-base");
});

test("相同输入稳定输出", () => {
  assert.deepEqual(resolve(BASE, "../g"), resolve(BASE, "../g"));
});

test("非法输入报错", () => {
  assert.throws(() => resolve("/relative/base", "g"), (e: any) => e.code === "BASE_NOT_ABSOLUTE");
  assert.throws(() => resolve(BASE, "g%2"), (e: any) => e.code === "INVALID_PERCENT_ENCODING");
  assert.throws(() => resolve(BASE, "g%zz"), (e: any) => e.code === "INVALID_PERCENT_ENCODING");
  assert.throws(() => resolve(BASE, "g h"), (e: any) => e.code === "CONTROL_CHAR");
  assert.throws(() => resolve(BASE, "g\t"), (e: any) => e.code === "CONTROL_CHAR");
  assert.throws(() => resolve(BASE, "中文"), (e: any) => e.code === "NON_ASCII");
  assert.throws(() => resolve("1http://a/", "g"), (e: any) => e.code === "INVALID_SCHEME");
  assert.ok(new UriError("VALIDATION_ERROR", "x") instanceof Error);
});

test("removeDotSegments 基本行为", () => {
  assert.equal(removeDotSegments("/a/b/c/./../../g"), "/a/g");
  assert.equal(removeDotSegments("mid/content=5/../6"), "mid/6");
  assert.equal(removeDotSegments(""), "");
  assert.equal(removeDotSegments("/"), "/");
});
