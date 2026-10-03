# URI 相对引用解析与路径合并解释后端

离线、本地运行的 URI 引用解析服务。输入一个**绝对基准 URI** 和一个**引用**，按
[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) 第 5 节的通用分层语法输出解析后的
绝对 URI，并给出逐步解释报告。纯后端：TypeScript + Node.js + SQLite，仅提供 HTTP API 与 CLI。

## 功能边界

- 按 RFC 3986 处理 `scheme`、`authority`、`path`、`query`、`fragment` 五个组件。
- 组件拆分、相对路径合并（5.2.3）、点段消除（5.2.4）、严格转换（5.2.2）均为自行实现，
  **不使用 `new URL` 或任何现成 URI 解析器**完成核心逻辑。
- 不发起网络请求、不检查域名是否存在、不读取本机文件；不是浏览器、爬虫或路由网关。
- 输入限定 ASCII，允许合法百分号编码（`%HH`）；不做国际化域名（IDN）转换，
  不做浏览器特有的反斜杠修正。
- 只消除路径中**实际的** `.` 与 `..` 段；`%2e`、`%2E`、`%2F` 等编码不会被提前解码，
  query 与 fragment 中的类似字符保持原样。
- 区分“没有 query”与“显式空 query”（`?`），“没有 fragment”与“显式空 fragment”（`#`）。
  空引用继承基准的路径与查询，但不继承其片段。
- 路径到根后多余的 `..` 被丢弃，不产生虚构的上级（RFC 3986 5.4.2 异常示例行为）。

## 环境要求

- Windows 本地运行，无需 Docker / WSL / 付费服务 / 外部在线 API。
- Node.js ≥ 22.5（使用内置 `node:sqlite`，无需原生编译；开发环境为 Node 25）。
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）。

## 快速开始

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 构建并运行全部测试（RFC 3986 5.4 固定预期 + 边界用例）
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo       # 运行 RFC 3986 演示用例
node scripts/smoke.mjs   # 端到端冒烟测试（启动服务->单条/批量/历史）
```

## CLI

```powershell
node dist/cli.js resolve "http://a/b/c/d;p?q" "../g"   # 单条解析，打印完整报告
node dist/cli.js batch items.json                      # 批量解析 [{base, reference}, ...]
node dist/cli.js history --limit 20                    # 查看历史
node dist/cli.js export out.json                       # 导出历史为 JSON（不带参数则打印到 stdout）
node dist/cli.js serve --port 8080                     # 指定端口；缺省为 0（自动选空闲端口）
node dist/cli.js demo                                  # 演示用例
```

数据目录默认为项目内 `./data`（可用环境变量 `URI_RESOLVER_DATA_DIR` 覆盖），
端口也可用环境变量 `PORT` 指定。SQLite 数据库文件为 `data/uri-resolver.db`，
每条记录保存输入、算法版本（`rfc3986-5.2.2-strict-v1`）与完整报告 JSON，服务重启后仍可读取。

## HTTP API

所有响应均为 JSON；批量结果按 `index` 逐项定位错误。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/resolve` | 单条：`{"base": "...", "reference": "..."}`；批量：`{"items": [{base, reference}, ...]}`（1–1000 条） |
| GET | `/api/history?limit=50&offset=0` | 历史记录（limit 1–500） |
| GET | `/api/history/:id` | 单条历史，含解析后的报告对象 |
| GET | `/api/export` | 导出全部历史为 JSON 文件 |

错误码：`NON_ASCII`（非 ASCII 字符）、`CONTROL_CHAR`（空格或控制字符）、
`INVALID_PERCENT_ENCODING`（非法百分号编码）、`INVALID_SCHEME`（scheme 不合法）、
`BASE_NOT_ABSOLUTE`（基准不是绝对 URI）、`VALIDATION_ERROR`（参数类型错误）、
`NOT_FOUND`、`INTERNAL`。单条解析失败返回 HTTP 422；批量中失败项在 `results[i].error` 中给出
错误码与消息，不影响其他项。

## 报告结构

```json
{
  "algorithmVersion": "rfc3986-5.2.2-strict-v1",
  "base":      { "raw": "...", "components": { "scheme": "...", "authority": "...", "path": "...", "query": "..." } },
  "reference": { "raw": "...", "components": { "path": "../g" } },
  "steps": {
    "scheme":    { "value": "http", "source": "base" },
    "authority": { "value": "a",    "source": "base" },
    "mergedPath": "/b/c/../g",
    "dotSegmentsRemovedPath": "/b/g",
    "pathSource": "merged",
    "query":    { "source": "none" },
    "fragment": { "source": "none" }
  },
  "result": { "scheme": "http", "authority": "a", "path": "/b/g" },
  "uri": "http://a/b/g"
}
```

`source` 标明每个组件继承自基准还是引用；`pathSource` 取值：
`merged`（与基准目录合并）、`reference-absolute`（以 `/` 开头替换基准路径）、
`reference-with-authority`（引用自带 authority）、`inherited-base`（空路径继承基准路径）。

## 演示（基准 `http://a/b/c/d;p?q`）

| 引用 | 结果 |
| --- | --- |
| `g` | `http://a/b/c/g` |
| `../g` | `http://a/b/g` |
| `/g` | `http://a/g` |
| `//g` | `http://g` |
| `?y` | `http://a/b/c/d;p?y` |
| `#s` | `http://a/b/c/d;p?q#s` |
| （空引用） | `http://a/b/c/d;p?q` |
| `%2e%2e/g` | `http://a/b/c/%2e%2e/g`（编码点段不消除） |
| `../%2E/g` | `http://a/b/%2E/g`（普通 `..` 消除，编码点段保留） |

## 测试

`test/uri.test.ts` 使用 RFC 3986 第 5.4.1（正常）与 5.4.2（异常）节的示例作为**固定预期**
（非解析器自身往返），另覆盖：多层 `..` 越根、尾部 `/.` 与 `/..`、空 query、空 fragment、
query 中的斜杠、重复斜杠、带空路径的主机、百分号编码点段、非法输入报错等。
`test/store.test.ts` 覆盖持久化（重启后可读原始报告）、批量错误逐项定位与 HTTP API。

## 已知限制

- 仅处理 RFC 3986 通用语法，不做 scheme 特定规则（如 `http:` 默认端口归一化）。
- 不做百分号解码、大小写归一化等“规范化”（第 6 节），只做第 5 节的解析。
- `node:sqlite` 在 Node 25 中仍标记为实验特性，启动时会有 ExperimentalWarning，不影响功能。
