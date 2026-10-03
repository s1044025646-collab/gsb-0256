# URI 相对引用解析与路径合并解释后端

离线的 RFC 3986 通用 URI 引用解析服务。输入一个**绝对基准 URI** 与一个**引用**（相对或绝对），
输出解析后的绝对 URI，并给出可人工核对的**逐步解释报告**：原始组件、组件继承来源、
路径合并结果、点段消除结果、最终拼装结果。

- 纯后端：HTTP API + CLI，无任何前端页面
- 技术栈：TypeScript + Node.js（内置 `node:http`）+ SQLite（内置 `node:sqlite`）
- **零第三方运行时依赖**；开发期仅使用 `typescript`、`tsx`、`@types/node`
- 完全离线：**不发起网络请求、不做 DNS 查询、不读取本机文件**（SQLite 数据文件除外），
  也不实现浏览器、爬虫或网关
- 数据保存在项目内 `data/` 目录，服务重启后历史报告仍可读取

## 支持边界（重要）

- 只接受 **ASCII** 输入；非 ASCII 字符（含中文域名/IDN）直接报错，**不做国际化域名转换**。
- 允许合法百分号编码（`%HH`，H 为十六进制数字）；`%2e`、`%2f` 等**保持原样、不解码**。
  因此 `%2e%2e` 不是点段、`%2f` 不是路径分隔符。
- 反斜杠 `\` 一律报错，**不做浏览器风格的 `\` 到 `/` 修正**。
- 控制字符、空格、非法百分号编码、组件中不允许的字符均返回明确错误码，**不静默替换**。
- 重复斜杠按普通空段保留，不做规范化折叠。
- 不校验域名是否真实存在、不校验端口是否开放、不判断 IP-literal 的可达性。
- 不实现特定 scheme（http/https/file 等）的特殊规则，严格按 RFC 3986 通用分层语法处理。

## 关键语义

- **无 query 与显式空 query 不同**：`g?` 保留结尾 `?`；引用不带 `?` 时才继承基准 query。
- **无 fragment 与显式空 fragment 不同**：`g#` 保留结尾 `#`；引用不带 `#` 时结果没有 fragment，
  **绝不继承基准 fragment**（空引用同样不继承）。
- 带 `//authority` 的引用替换主机部分；以 `/` 开头的路径整体替换基准路径；
  其余相对路径与基准“最后一个 `/` 之前的目录”合并（基准有 authority 但路径为空时前置 `/`）。
- 点段消除（RFC 5.2.4）只处理真正的 `.` / `..` 段；路径到根后多余的 `..` 直接丢弃，
  不会产生 `/../` 之类的虚构上级。
- query 与 fragment 中的 `/`、`.`、`..` 一律原样保留。

## 环境要求

- Node.js **>= 22.5**（开发与验证使用 Node v25，`node:sqlite` 目前需 `--experimental-sqlite` 标志）
- Windows / macOS / Linux 均可；无需 Docker、WSL 或任何在线服务

## 安装与构建

```powershell
npm install
npm run build
```

## 运行测试

```powershell
npm test
```

测试包含 RFC 3986 5.4.1（正常示例）与 5.4.2（异常示例）的**固定预期**，
以及多层 `..`、尾部 `/.` 与 `/..`、空 query/空 fragment、query 中的斜杠、
重复斜杠、空路径主机、百分号编码点段、SQLite 重启持久化与 HTTP API 集成用例。

## 演示（RFC 5.4 基准 http://a/b/c/d;p?q）

```powershell
npm run demo
```

核心 7 例：

| 引用 | 结果 | 说明 |
| --- | --- | --- |
| `g` | `http://a/b/c/g` | 与基准目录 `/b/c/` 合并 |
| `../g` | `http://a/b/g` | 单层上溯 |
| `/g` | `http://a/g` | 绝对路径替换 |
| `//g` | `http://g` | 仅替换主机，路径为空 |
| `?y` | `http://a/b/c/d;p?y` | 路径继承，query 替换 |
| `#s` | `http://a/b/c/d;p?q#s` | 路径与 query 继承，fragment 替换 |
| `''`（空引用） | `http://a/b/c/d;p?q` | 路径与 query 继承，fragment 不继承 |

百分号编码与普通点段的区别：

| 引用 | 结果 | 说明 |
| --- | --- | --- |
| `../g` | `http://a/b/g` | 字面 `..` 被点段消除 |
| `%2e%2e/g` | `http://a/b/c/%2e%2e/g` | 编码点不解码，是普通段名 |
| `a/%2e%2e/b` | `http://a/b/c/a/%2e%2e/b` | 不触发上溯 |
| `a/%2F../b` | `http://a/b/c/a/%2F../b` | `%2F` 不是分隔符 |

## 启动 HTTP 服务

```powershell
# 构建后运行（默认让操作系统分配空闲端口，仅监听 127.0.0.1）
npm start

# 开发模式直接运行 TS
npm run dev

# 固定端口（默认仍是空闲端口）
$env:PORT="8080"; npm start

# 自定义数据库路径（默认 ./data/uri-reports.db）
$env:URI_DB_PATH="E:\GSB\0256\B\data\demo.db"; npm start
```

启动后会打印实际 URL（空闲端口随机）。

### API

所有请求/响应均为 JSON。

**POST `/api/resolve`** — 单条解析

```json
{ "base": "http://a/b/c/d;p?q", "reference": "../g" }
```

成功返回 `200`：`{ "ok": true, "id": 1, "report": { ... } }`；
解析错误返回 `422`：`{ "ok": false, "id": 2, "error": { "code", "message", "position?" } }`。
错误记录同样入库，可通过 `id` 取回。

**POST `/api/batch`** — 批量解析（单批最多 1000 条），错误逐项定位，不影响其他条目：

```json
{
  "base": "http://a/b/c/d;p?q",
  "items": [
    { "reference": "g" },
    { "reference": "a/%zz" },
    { "base": "http://other/x/y", "reference": "/z" }
  ]
}
```

响应：`{ "total", "succeeded", "failed", "results": [ { "index", "ok" } ] }`。

**GET `/api/history?limit=50&offset=0`** — 历史列表（含成功与失败）

**GET `/api/history?q=关键字`** — 在 base / reference / 结果中模糊搜索

**GET `/api/reports/<id>`** — 取单条完整原始报告 JSON

**GET `/api/export?limit=1000`** — JSON 导出（含时间、输入、算法版本、完整报告）

**GET `/health`** — 健康检查与算法版本

调用示例（PowerShell）：

```powershell
$u = 'http://127.0.0.1:<实际端口>'
Invoke-RestMethod "$u/api/resolve" -Method Post `
  -Body (@{base='http://a/b/c/d;p?q';reference='../g'} | ConvertTo-Json) `
  -ContentType 'application/json'
```

## CLI

```powershell
# 单条（空引用传 ""；--verbose 输出完整逐步报告）
node --experimental-sqlite dist/cli.js resolve "http://a/b/c/d;p?q" "../g" --verbose

# 批量（错误按 index 定位，进程退出码 2 表示存在解析错误）
node --experimental-sqlite dist/cli.js batch examples/batch.json --out data/batch-result.json

# 历史 / 单条 / 导出
node --experimental-sqlite dist/cli.js history --limit 10
node --experimental-sqlite dist/cli.js history --q "../g"
node --experimental-sqlite dist/cli.js get 1
node --experimental-sqlite dist/cli.js export data/export.json --limit 1000

# 不先构建也可用 TS 源码运行
npm run cli -- resolve "http://a/b/c/d;p?q" "?y" --verbose
```

退出码：`0` 成功；`2` 批量中存在解析错误（每条错误仍带 index 与错误码）；`1` 用法或 IO 错误。

## 报告结构

`report` 字段包含：

- `algorithmVersion`：算法版本标识（如 `rfc3986-5.2/1.0.0`）
- `input`：原始 base / reference
- `baseComponents` / `referenceComponents`：拆分出的 scheme / authority / path / query / fragment
  （字段缺省表示组件不存在，空字符串表示显式为空）
- `mergedPath`：合并后、点段消除前的路径
- `dotRemovedPath`：点段消除后的路径
- `targetComponents`：最终组件
- `inherit`：每个组件来自 `reference` / `base` / `merged` / `none`
- `resolvedUri`：最终拼装结果
- `steps`：中文逐步解释

## 错误码

| code | 含义 |
| --- | --- |
| `INVALID_INPUT` | 入参类型/结构错误 |
| `INVALID_ASCII` | 含非 ASCII 字符 |
| `CONTROL_CHARACTER` | 含 ASCII 控制字符 |
| `BACKSLASH_NOT_ALLOWED` | 含反斜杠（不做浏览器式修正） |
| `INVALID_PERCENT_ENCODING` | `%` 后不是两个十六进制数字 |
| `INVALID_CHARACTER` | 组件内存在 URI 语法不允许的字符（含空格） |
| `INVALID_SCHEME` / `INVALID_AUTHORITY` / `INVALID_HOST` / `INVALID_PORT` / `INVALID_USERINFO` / `INVALID_IP_LITERAL` | 对应组件语法错误 |
| `BASE_NOT_ABSOLUTE` | 基准不是绝对 URI（缺少 scheme） |

## 项目结构

```
src/
  uri/charset.ts        组件字符集与百分号编码严格校验
  uri/errors.ts         错误类型与错误码
  uri/parser.ts         RFC 3986 组件拆分（未使用 new URL 或第三方解析器）
  uri/resolve.ts        RFC 5.2.2 / 5.2.4 解析、路径合并、点段消除与报告
  store/db.ts           SQLite 持久化
  server.ts             HTTP API（空闲端口默认）
  cli.ts                命令行
  demo.ts               RFC 5.4 固定预期演示
examples/batch.json     批量输入示例
data/                   SQLite 数据库与导出（运行时生成）
```
