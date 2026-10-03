import { UriError } from './errors.js';
import { recompose, parseAbsoluteBase, parseUriReference, UriComponents } from './parser.js';

export const ALGORITHM_VERSION = 'rfc3986-5.2/1.0.0';

export interface InheritTrace {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

export interface ResolveReport {
  algorithmVersion: string;
  input: { base: string; reference: string };
  baseComponents: UriComponents;
  referenceComponents: UriComponents;
  mergedPath: string;
  dotRemovedPath: string;
  targetComponents: UriComponents;
  inherit: InheritTrace;
  resolvedUri: string;
  steps: string[];
}

/**
 * RFC 3986 5.2.4 remove_dot_segments。
 * 只处理“真正的”点段，即路径切分后恰好等于 "." 或 ".." 的段。
 * 百分号编码形式（%2e、%2f 等）不是字面点/斜杠，保持原样。
 */
export function removeDotSegments(path: string): { result: string; steps: string[] } {
  const steps: string[] = [];
  let input = path;
  let output = '';

  while (input.length > 0) {
    if (input.startsWith('../')) {
      steps.push('移除前缀 "../"');
      input = input.slice(3);
    } else if (input.startsWith('./')) {
      steps.push('移除前缀 "./"');
      input = input.slice(2);
    } else if (input.startsWith('/./')) {
      steps.push('将 "/./" 替换为 "/"');
      input = '/' + input.slice(3);
    } else if (input === '/.') {
      steps.push('将结尾 "/." 替换为 "/"');
      input = '/';
    } else if (input.startsWith('/../')) {
      input = '/' + input.slice(4);
      output = removeLastSegment(output);
      steps.push('将 "/../" 替换为 "/"，并移除 output 最后一段');
    } else if (input === '/..') {
      input = '/';
      output = removeLastSegment(output);
      steps.push('将结尾 "/.." 替换为 "/"，并移除 output 最后一段');
    } else if (input === '.' || input === '..') {
      steps.push(`丢弃剩余的 "${input}"`);
      input = '';
    } else {
      // 移动第一段（包括起始 "/"，如果有）到 output
      const start = input.startsWith('/') ? 1 : 0;
      let next = input.indexOf('/', start);
      if (next === -1) next = input.length;
      const seg = input.slice(0, next);
      output += seg;
      steps.push(`移动路径段 "${seg}" 到输出`);
      input = input.slice(next);
    }
  }

  return { result: output, steps };
}

function removeLastSegment(output: string): string {
  const idx = output.lastIndexOf('/');
  return idx === -1 ? '' : output.slice(0, idx);
}

/**
 * RFC 3986 5.2.2 Transform References，5.3 Merge Paths。
 */
export function resolveReference(baseInput: string, refInput: string): ResolveReport {
  const base = parseAbsoluteBase(baseInput);
  const ref = parseUriReference(refInput);
  const steps: string[] = [];

  const target: UriComponents = { path: '' };
  const inherit: InheritTrace = {
    scheme: 'reference',
    authority: 'reference',
    path: 'reference',
    query: 'reference',
    fragment: 'reference',
  };

  let mergedPath = '';

  if (ref.scheme !== undefined && ref.scheme !== base.scheme) {
    // A) 引用自带不同 scheme：使用引用自身全部组件，路径做点段消除
    target.scheme = ref.scheme;
    target.authority = ref.authority;
    target.path = ref.path;
    target.query = ref.query;
    mergedPath = ref.path;
    steps.push(`引用自带不同 scheme "${ref.scheme}"，使用引用自身组件（RFC 5.2.2 A）`);
  } else if (ref.scheme !== undefined && ref.authority === undefined) {
    // 相同 scheme 但无 authority 的引用（如 http:g，RFC 5.4.2 异常示例）：
    // scheme 取引用，authority 被丢弃（不继承主机），路径按自身处理。
    target.scheme = ref.scheme;
    target.authority = undefined;
    inherit.scheme = 'reference';
    inherit.authority = 'none';
    mergedPath = ref.path;
    target.path = ref.path;
    target.query = ref.query;
    inherit.path = 'reference';
    inherit.query = ref.query === undefined ? 'none' : 'reference';
    steps.push(`引用带与基准相同的 scheme "${ref.scheme}" 但无 authority，丢弃主机组件（RFC 5.4.2 http:g）`);
  } else {
    // 无 scheme 的相对引用；scheme 继承基准
    target.scheme = base.scheme;
    inherit.scheme = 'base';

    if (ref.authority !== undefined) {
      target.authority = ref.authority;
      target.path = ref.path;
      target.query = ref.query;
      inherit.authority = 'reference';
      inherit.path = 'reference';
      inherit.query = ref.query === undefined ? 'base' : 'reference';
      mergedPath = ref.path;
      steps.push('引用带 authority（以 "//" 开头），替换主机部分，路径整体替换基准路径（RFC 5.2.2 B/C）');
    } else {
      target.authority = base.authority;
      inherit.authority = 'base';

      if (ref.path === '') {
        // E) 引用路径为空：继承基准路径
        target.path = base.path;
        mergedPath = base.path;
        inherit.path = 'base';
        if (ref.query !== undefined) {
          target.query = ref.query;
          inherit.query = 'reference';
          steps.push('引用路径为空，路径继承基准；引用自带 query，使用引用 query（RFC 5.2.2 E）');
        } else {
          target.query = base.query;
          inherit.query = base.query === undefined ? 'none' : 'base';
          steps.push('空引用（或仅含 fragment）：路径与 query 均继承基准（RFC 5.2.2 E）');
        }
      } else {
        if (ref.path.startsWith('/')) {
          // C) 绝对路径：直接替换
          target.path = ref.path;
          mergedPath = ref.path;
          inherit.path = 'reference';
          steps.push('引用路径以 "/" 开头（绝对路径），直接替换基准路径（RFC 5.2.2 C）');
        } else {
          // D) 相对路径：与基准“所在目录”合并
          mergedPath = mergePaths(base, ref.path);
          target.path = mergedPath;
          inherit.path = 'merged';
          steps.push(`引用路径为相对路径，与基准所在目录合并："${ref.path}" -> "${mergedPath}"（RFC 5.2.2 D / 5.3）`);
        }
        target.query = ref.query;
        inherit.query = ref.query === undefined ? 'none' : 'reference';
      }
    }
  }

  // 5.2.4 点段消除（仅路径）
  const dotResult = removeDotSegments(target.path);
  target.path = dotResult.result;

  // F) fragment：引用没有 fragment 时目标也没有 —— 绝不继承基准 fragment
  target.fragment = ref.fragment;
  inherit.fragment = ref.fragment === undefined ? 'none' : 'reference';
  steps.push('fragment 始终取引用；引用无 fragment 时结果也无 fragment（不继承基准 fragment，RFC 5.2.2 F）');

  const resolvedUri = recompose(target);
  steps.push(`按 scheme://authority/path?query#fragment 重新拼装："${resolvedUri}"`);

  return {
    algorithmVersion: ALGORITHM_VERSION,
    input: { base: baseInput, reference: refInput },
    baseComponents: base,
    referenceComponents: ref,
    mergedPath,
    dotRemovedPath: target.path,
    targetComponents: target,
    inherit,
    resolvedUri,
    steps,
  };
}

/**
 * RFC 3986 5.3 Merge：
 * - 基准有 authority 且路径为空 -> "/" + 引用路径
 * - 否则取基准路径最后一个 "/" 之前的部分 + 引用路径
 */
export function mergePaths(base: UriComponents, refPath: string): string {
  if (base.authority !== undefined && base.path === '') {
    return '/' + refPath;
  }
  const lastSlash = base.path.lastIndexOf('/');
  const prefix = lastSlash === -1 ? '' : base.path.slice(0, lastSlash + 1);
  return prefix + refPath;
}

export function validateInputs(base: unknown, reference: unknown): { base: string; reference: string } {
  if (typeof base !== 'string' || base.length === 0) {
    throw new UriError('INVALID_INPUT', '参数 "base" 必须是非空字符串');
  }
  if (typeof reference !== 'string') {
    throw new UriError('INVALID_INPUT', '参数 "reference" 必须是字符串（可以为空字符串，表示空引用）');
  }
  return { base, reference };
}
