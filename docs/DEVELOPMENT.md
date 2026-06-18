# LiteOJ 开发文档

本文面向后续维护者，说明 LiteOJ 的技术结构、核心链路、接口约定、数据模型和开发规范。

## 1. 技术栈

- 后端：Node.js + Express
- 数据库：SQLite，使用 `better-sqlite3`
- 前端：无构建步骤的单页应用，位于 `frontend/public/`
- 评测端：独立 Node.js worker，轮询后端任务
- Markdown：前端轻量渲染器 + KaTeX
- 测试点 zip：`multer` + `adm-zip`

项目没有 React/Vue/Vite/Webpack 等构建依赖，部署时直接由 Express 托管静态文件。

## 2. 启动流程

### 初始化

```bash
npm run init
```

`init` 会执行：

1. 数据库迁移；
2. 创建默认管理员；
3. 复制 `seed/problems` 到 `data/problems`；
4. 导入示例编程题；
5. 导入 `seed/prelim` 中的 CSP-J1 初赛试卷和解析。

默认管理员：

```text
admin / admin123
```

该默认密码只用于本地开发和测试。`NODE_ENV=production` 下首次初始化必须提供强 `ADMIN_PASSWORD`，否则初始化会失败。

可用环境变量覆盖：

```bash
ADMIN_USERNAME=teacher ADMIN_PASSWORD=change-me npm run init
```

### Web 服务

```bash
npm start
```

入口为：

```text
backend/server.js
```

默认监听：

```text
0.0.0.0:3000
```

### Judge worker

```bash
npm run judge
```

入口为：

```text
judge/worker.js
```

worker 会请求：

```text
POST /api/judge/acquire
POST /api/judge/:id/result
```

并使用 `JUDGE_TOKEN` 鉴权。

公网同机部署不要直接使用默认 `host` 模式。推荐使用根目录脚本：

```bash
./start.sh
```

脚本会启动 Web 容器，并在宿主机以 `JUDGE_SANDBOX=docker` 启动 judge worker。这样用户代码会进入无网络 Docker 沙箱，而不会和 Web 容器或 judge worker 共享同一进程空间。

## 3. 目录说明

```text
backend/             后端 API 和数据库逻辑
backend/routes/      分模块 API
frontend/public/     SPA 页面、样式、Logo
judge/               编译运行与判题逻辑
seed/problems/       初始化编程题
seed/prelim/         初始化初赛试卷
scripts/             初始化和测试脚本
data/                运行数据目录
docs/                项目文档
```

## 4. 核心模块

### 4.1 用户与权限

相关文件：

```text
backend/auth.js
backend/routes/auth.js
```

用户角色：

```text
user
admin
```

鉴权方式：JWT 写入 `liteoj_token` Cookie。

注册接口在非生产环境会保留“第一个注册用户成为 admin”的开发便利；`NODE_ENV=production` 下注册用户始终是普通 `user`，管理员必须由初始化脚本根据 `ADMIN_USERNAME/ADMIN_PASSWORD` 创建。

Cookie 规则：

- `HttpOnly`
- `SameSite=Lax`
- `COOKIE_SECURE=auto` 时，HTTPS 请求自动添加 `Secure`，本地 HTTP 不添加

### 4.2 编程题库

相关文件：

```text
backend/routes/problems.js
backend/problem-utils.js
frontend/public/app.js
```

题号规则：

```text
^[A-Z]+\d+$
```

合法示例：

```text
P1001
ABC12
```

默认排序：

1. 英文字母前缀按字典序；
2. 后续数字按数值大小。

例如：

```text
ABC2 < ABC10 < B1 < P1 < P10
```

题面只保留一个 Markdown 字段 `description`，输入格式、输出格式、样例、提示和数据范围都写在这个字段中。

编程题评测配置：

```text
scoringMode: oi / acm
checkerMode: standard / ignore_space / case_insensitive / float
checkerTolerance: 浮点比较误差，默认 1e-6
```

`oi` 表示按测试点或子任务累计分数；`acm` 表示全部测试点通过才获得本题全部分数。

### 4.3 测试点管理

测试点记录在 `problem_cases` 表中，实际文件存储在：

```text
data/problems/<题号>/testdata/
```

zip 上传接口：

```text
POST /api/problems/:id/cases/zip
```

支持：

```text
1.in + 1.out
1.in + 1.ans
subtask/1.in + subtask/1.out
```

zip 中的目录名会写入 `problem_cases.subtask`。同一 `subtask` 下只要有测试点失败，该子任务内所有测试点均不得分；没有子任务名的测试点按单点计分。

后台删除测试点调用：

```text
DELETE /api/problems/:problemId/cases/:caseId
```

### 4.4 评测链路

完整链路：

```text
用户提交代码
↓
POST /api/problems/:id/submit
↓
submissions 表写入 Waiting
↓
judge worker 轮询 /api/judge/acquire
↓
编译、运行、逐测试点比较，按 OI/ACM/子任务规则结算
↓
POST /api/judge/:id/result
↓
前端提交详情展示结果
```

状态：

```text
Waiting
Judging
AC
WA
TLE
RE
CE
PA
SE
```

judge 支持两种运行模式：

```text
JUDGE_SANDBOX=host    # 代码默认值，本地 timeout + ulimit + 临时目录
JUDGE_SANDBOX=docker  # 每次编译/运行进入无网络 Docker 容器
```

`docker` 模式会使用 `JUDGE_SANDBOX_IMAGE`，默认 `liteoj:latest`。公网同机部署时，推荐 Web 使用 Docker Compose `app` 服务，judge worker 在宿主机运行，并通过 Docker CLI 创建一次性沙箱容器。不要把 Docker socket 挂给 Web 容器。

`docker-compose.yml` 中的 `judge` 服务放在 `container-judge` profile 下，主要用于本地和可信内网教学：

```bash
docker compose --profile container-judge up -d --build
```

它不是陌生公网提交的推荐路径。

### 4.5 初赛题库

相关文件：

```text
backend/routes/prelim.js
backend/prelim-utils.js
frontend/public/app.js
```

数据结构：

```text
prelim_papers       试卷元信息
prelim_groups       整题，阅读程序/完善程序的公共代码放这里
prelim_questions    小题，保存选项、答案、解析、知识点、分值
prelim_attempts     单题练习记录
prelim_mock_exams   模考记录
```

阅读程序和完善程序使用“整题 + 小题”结构，避免公共代码重复存储和重复显示。

### 4.6 初赛模考

模考从 `prelim_papers` 和 `prelim_groups` 组卷。

主要接口：

```text
GET  /api/prelim/mock/papers
POST /api/prelim/mock/start
GET  /api/prelim/mock/exams/:id
POST /api/prelim/mock/exams/:id/submit
GET  /api/prelim/mock/exams/:id/report
```

总分使用试卷官方总分 `prelim_papers.total_score`。

### 4.7 数据分析

相关文件：

```text
backend/routes/analytics.js
frontend/public/app.js
frontend/public/style.css
```

接口：

```text
GET /api/analytics/prelim/options
GET /api/analytics/prelim/knowledge?years=2025,2024&groupName=CSP-J
```

`/knowledge` 路径为兼容既有接口命名保留，页面和文档中统一称为“考点”分析。

页面只保留：

```text
年份下拉多选
组别 CSP-J / CSP-S
分析按钮
```

年份和组别默认均不预选，用户点击“分析”前必须显式选择。

统计结果：

1. 考点出现次数柱状图；
2. 考点加权分值中空饼图；
3. 各年份考点加权分值对照表。

加权规则：

```text
每个小题独立计算。
只有 1 个考点：该考点获得该小题全部分值。
有 2 个及以上考点：只取权重最高的两个，按权重比例分配分值。
权重缺失或都为 0：最高两个考点平均分配。
```

### 4.8 账号与安全响应头

账号密码相关逻辑集中在 `backend/passwords.js`，注册、登录和个人主页改密均通过统一的 bcrypt 哈希与校验函数处理。`backend/routes/profile.js` 负责登录用户的个人主页改密接口，避免把账号设置逻辑散落到其他业务模块中。

HTTP 安全响应头集中在 `backend/security.js`，由 `backend/server.js` 在所有路由前统一挂载。API 默认使用 `no-store` 缓存策略，静态资源使用短时缓存，SPA 入口使用 `no-cache`。

`backend/security.js` 还提供轻量内存限速器。登录和注册接口分别使用 `LOGIN_RATE_LIMIT`、`REGISTER_RATE_LIMIT` 控制单 IP 窗口内请求数，防止最基础的撞库和注册刷量。

测试数据 zip 上传除了 `TESTDATA_ZIP_LIMIT` 压缩包大小限制，还会用 `TESTDATA_UNZIPPED_LIMIT` 限制解压后总大小，降低 zip bomb 风险。

## 5. API 概览

### 用户

```text
GET  /api/auth/me
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
```

### 编程题

```text
GET    /api/problems
GET    /api/problems/facets
GET    /api/problems/next-id
POST   /api/problems
GET    /api/problems/:id
PUT    /api/problems/:id
PATCH  /api/problems/:id/status
POST   /api/problems/:id/status
POST   /api/problems/:id/clone
DELETE /api/problems/:id
POST   /api/problems/:id/attachments
GET    /api/problems/:id/attachments/:filename
GET    /api/problems/:id/cases
POST   /api/problems/:id/cases
PUT    /api/problems/:id/cases/:caseId
DELETE /api/problems/:id/cases/:caseId
POST   /api/problems/:id/cases/zip
POST   /api/problems/:id/rejudge
POST   /api/problems/:id/submit
```

### 提交记录

```text
GET  /api/submissions
GET  /api/submissions/:id
POST /api/submissions/:id/rejudge
```

### 初赛题库与模考

```text
GET    /api/prelim/papers
GET    /api/prelim/facets
GET    /api/prelim/items
GET    /api/prelim/items/:id
GET    /api/prelim/questions
GET    /api/prelim/questions/:id
GET    /api/prelim/papers/:id
POST   /api/prelim/questions/:id/check
POST   /api/prelim/import-md
DELETE /api/prelim/papers/:id
POST   /api/prelim/items/:id/status
POST   /api/prelim/questions/:id/status
GET    /api/prelim/mock/papers
POST   /api/prelim/mock/start
GET    /api/prelim/mock/exams/:id
POST   /api/prelim/mock/exams/:id/submit
GET    /api/prelim/mock/exams/:id/report
```

### 数据分析

```text
GET /api/analytics/prelim/options
GET /api/analytics/prelim/knowledge
```

### 后台

```text
GET   /api/admin/stats
GET   /api/admin/users
PATCH /api/admin/users/:id/role
```

### Judge

```text
POST /api/judge/acquire
POST /api/judge/:id/result
```

## 6. 前端开发约定

前端是单页应用，核心在：

```text
frontend/public/app.js
```

路由使用：

```js
nav('/path')
```

按钮或链接统一使用：

```html
<button type="button" data-route="/path">...</button>
<a href="/path" data-route="/path">...</a>
```

全局事件代理会拦截 `[data-route]`，交给 SPA 路由处理。

不要使用：

```html
href="javascript:nav(...)"
onclick="nav(...)"
```

表格操作按钮必须放在：

```html
<td>
  <div class="table-action-row">...</div>
</td>
```

不要让 `td` 本身 `display:flex`，否则表格横线会错位。

## 7. 数据库迁移规范

数据库迁移写在：

```text
backend/db.js
```

原则：

- 新表用 `CREATE TABLE IF NOT EXISTS`。
- 旧库兼容用 `ensureColumn` 追加字段。
- 不在初始化脚本里删除用户数据。
- 示例题可以在特定条件下刷新，例如 P1001 题面和标签的历史兼容逻辑。

## 8. 测试规范

语法检查：

```bash
npm run check
```

静态 smoke：

```bash
npm run smoke
```

真实链路 smoke：

```bash
npm run real-smoke
```

完整测试：

```bash
npm test
```

`real-smoke` 会创建临时数据目录和端口，测试登录、新增题、编辑题、评分/checker 配置、测试点子任务、zip 上传、复制、隐藏/公开、删除、提交、初赛题库和模考接口。

## 9. 后续开发建议

优先保持项目轻量，不建议过早引入复杂框架。新增功能时注意：

- 编程题库和初赛题库保持独立。
- 前端路由不要混用整页跳转和 SPA 跳转。
- 后台按钮统一使用 `data-route` 或 `data-action`。
- 任何新增接口都应进入 smoke-test。
- judge 安全性是正式公网部署的重点；同机部署使用宿主机 judge + Docker 沙箱作为基础防线，独立 VM/主机仍然是更强方案。
