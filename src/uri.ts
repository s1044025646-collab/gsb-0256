/**
 * RFC 3986 第 5 节：URI 引用解析（相对引用 -> 绝对 URI）。
 * 自行实现组件拆分、路径合并与点段消除，不使用 new URL 等现成解析器。
 */

export const ALGORITHM_VERSION = "rfc3986-5.2.2-strict-v1";

export type ErrorCode =
  | "NON_ASCII"
  | "CONTROL_CHAR"
  | "INVALID_PERCENT_ENCODING"
  | "INVALID_SCHEME"
  | "BASE_NOT_ABSOLUTE"
  | "VALIDATION_ERROR";

export class UriError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public detail?: string
  ) {
    super(message);
    this.name = "UriError";
  }
}

export interface UriComponents {
  scheme?: string;
  authority?: string;
  path: string;
  /** undefined 表示没有 query；"" 表示显式空 query（"?"） */
  query?: string;
  /** undefined 表示没有 fragment；"" 表示显式空 fragment（"#"） */
  fragment?: string;
}

export interface ResolveReport {
  algorithmVersion: string;
  base: { raw: string; components: UriComponents };
  reference: { raw: string; components: UriComponents };
  steps: {
    scheme: { value?: string; source: "reference" | "base" };
    authority: { value?: string; source: "reference" | "base" | "none" };
    mergedPath?: string;
    dotSegmentsRemovedPath: string;
    pathSource: "reference-absolute" | "merged" | "inherited-base" | "reference-with-authority";
    query: { value?: string; source: "reference" | "base" | "none" };
    fragment: { value?: string; source: "reference" | "none" };
  };
  result: UriComponents;
  uri: string;
}

/** RFC 3986 Appendix B 拆分正则 */
const URI_RE = /^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*$/;

function validateInput(raw: string, what: string): void {
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c > 0x7e) {
      throw new UriError(
        "NON_ASCII",
        `${what} 包含非 ASCII 字符（位置 ${i}，U+${c.toString(16).toUpperCase()}）`,
        raw
      );
    }
    if (c < 0x21 || c === 0x7f) {
      throw new UriError(
        "CONTROL_CHAR",
        `${what} 包含空格或控制字符（位置 ${i}）`,
        raw
      );
    }
    if (raw[i] === "%") {
      const h = raw.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(h)) {
        throw new UriError(
          "INVALID_PERCENT_ENCODING",
          `${what} 在位置 ${i} 含有非法百分号编码 "%${h}"`,
          raw
        );
      }
      i += 2;
    }
  }
}

export function parseComponents(raw: string, what: string): UriComponents {
  validateInput(raw, what);
  const m = URI_RE.exec(raw)!;
  const comp: UriComponents = { path: m[5] ?? "" };
  if (m[2] !== undefined) {
    if (!SCHEME_RE.test(m[2])) {
      throw new UriError("INVALID_SCHEME", `${what} 的 scheme "${m[2]}" 不合法`, raw);
    }
    comp.scheme = m[2];
  }
  if (m[4] !== undefined) comp.authority = m[4];
  if (m[7] !== undefined) comp.query = m[7];
  if (m[9] !== undefined) comp.fragment = m[9];
  return comp;
}

/** RFC 3986 5.2.3 路径合并 */
export function mergePaths(base: UriComponents, refPath: string): string {
  if (base.authority !== undefined && base.path === "") {
    return "/" + refPath;
  }
  const idx = base.path.lastIndexOf("/");
  if (idx >= 0) {
    return base.path.slice(0, idx + 1) + refPath;
  }
  return refPath;
}

/** RFC 3986 5.2.4 点段消除（不解码百分号编码） */
export function removeDotSegments(path: string): string {
  let input = path;
  let output = "";
  while (input.length > 0) {
    if (input.startsWith("../")) {
      input = input.slice(3);
    } else if (input.startsWith("./")) {
      input = input.slice(2);
    } else if (input.startsWith("/./")) {
      input = input.slice(2);
    } else if (input === "/.") {
      input = "/";
    } else if (input.startsWith("/../")) {
      input = input.slice(3);
      output = output.slice(0, output.lastIndexOf("/"));
    } else if (input === "/..") {
      input = "/";
      output = output.slice(0, output.lastIndexOf("/"));
    } else if (input === "." || input === "..") {
      input = "";
    } else {
      let seg: string;
      if (input.startsWith("/")) {
        const next = input.indexOf("/", 1);
        seg = next === -1 ? input : input.slice(0, next);
      } else {
        const next = input.indexOf("/");
        seg = next === -1 ? input : input.slice(0, next);
      }
      output += seg;
      input = input.slice(seg.length);
    }
  }
  return output;
}

export function compose(c: UriComponents): string {
  let out = "";
  if (c.scheme !== undefined) out += c.scheme + ":";
  if (c.authority !== undefined) out += "//" + c.authority;
  out += c.path;
  if (c.query !== undefined) out += "?" + c.query;
  if (c.fragment !== undefined) out += "#" + c.fragment;
  return out;
}

/** RFC 3986 5.2.2 严格转换，返回逐步解释报告 */
export function resolve(baseRaw: string, refRaw: string): ResolveReport {
  const base = parseComponents(baseRaw, "基准 URI");
  if (base.scheme === undefined) {
    throw new UriError(
      "BASE_NOT_ABSOLUTE",
      "基准 URI 必须是绝对 URI（缺少 scheme）",
      baseRaw
    );
  }
  const ref = parseComponents(refRaw, "引用");

  const target: UriComponents = { path: "" };
  const steps: ResolveReport["steps"] = {
    scheme: { source: "base" },
    authority: { source: "none" },
    dotSegmentsRemovedPath: "",
    pathSource: "inherited-base",
    query: { source: "none" },
    fragment: { source: "none" },
  };

  if (ref.scheme !== undefined) {
    target.scheme = ref.scheme;
    steps.scheme = { value: ref.scheme, source: "reference" };
    target.authority = ref.authority;
    steps.authority =
      ref.authority !== undefined
        ? { value: ref.authority, source: "reference" }
        : { source: "none" };
    target.path = removeDotSegments(ref.path);
    steps.pathSource =
      ref.authority !== undefined ? "reference-with-authority" : "reference-absolute";
    steps.dotSegmentsRemovedPath = target.path;
    target.query = ref.query;
    steps.query =
      ref.query !== undefined
        ? { value: ref.query, source: "reference" }
        : { source: "none" };
  } else {
    target.scheme = base.scheme;
    steps.scheme = { value: base.scheme, source: "base" };
    if (ref.authority !== undefined) {
      target.authority = ref.authority;
      steps.authority = { value: ref.authority, source: "reference" };
      target.path = removeDotSegments(ref.path);
      steps.pathSource = "reference-with-authority";
      steps.dotSegmentsRemovedPath = target.path;
      target.query = ref.query;
      steps.query =
        ref.query !== undefined
          ? { value: ref.query, source: "reference" }
          : { source: "none" };
    } else {
      target.authority = base.authority;
      steps.authority =
        base.authority !== undefined
          ? { value: base.authority, source: "base" }
          : { source: "none" };
      if (ref.path === "") {
        target.path = base.path;
        steps.pathSource = "inherited-base";
        steps.dotSegmentsRemovedPath = target.path;
        if (ref.query !== undefined) {
          target.query = ref.query;
          steps.query = { value: ref.query, source: "reference" };
        } else {
          target.query = base.query;
          steps.query =
            base.query !== undefined
              ? { value: base.query, source: "base" }
              : { source: "none" };
        }
      } else {
        if (ref.path.startsWith("/")) {
          target.path = removeDotSegments(ref.path);
          steps.pathSource = "reference-absolute";
        } else {
          const merged = mergePaths(base, ref.path);
          steps.mergedPath = merged;
          target.path = removeDotSegments(merged);
          steps.pathSource = "merged";
        }
        steps.dotSegmentsRemovedPath = target.path;
        target.query = ref.query;
        steps.query =
          ref.query !== undefined
            ? { value: ref.query, source: "reference" }
            : { source: "none" };
      }
    }
  }
  target.fragment = ref.fragment;
  steps.fragment =
    ref.fragment !== undefined
      ? { value: ref.fragment, source: "reference" }
      : { source: "none" };

  return {
    algorithmVersion: ALGORITHM_VERSION,
    base: { raw: baseRaw, components: base },
    reference: { raw: refRaw, components: ref },
    steps,
    result: target,
    uri: compose(target),
  };
}
