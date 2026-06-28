# LiteOJ 架构说明

更新时间：2026-06-27

## 设计目标

LiteOJ 面向单机或同机云服务器部署，优先保证：

- 教学场景下的完整 OJ 闭环；
- 评测执行与 Web 业务分离；
- 测试数据和题面管理足够轻量；
- 国内服务器从空环境启动时可自动准备依赖；
- 代码结构简单，便于二次开发和排查。

## 进程与容器

```text
Browser
  |
  v
LiteOJ app container
  - Express API
  - SQLite database
  - frontend static files
  - testdata / attachments / checker.cpp
  |
  | /api/judge/acquire + /api/judge/cases/:caseId/:kind + /api/judge/:id/result
  v
Host judge worker
  - polls pending submissions
  - calls go-judge
  - computes score
  |
  v
go-judge container
  - compiles and runs user code
  - compiles and runs checker.cpp
```

`start.sh` 默认启动 `app` 和 `go-judge` 两个容器，并在宿主机启动 judge worker。`docker-compose.yml` 仍保留 `container-judge` profile，便于可信本地环境全容器化运行。

`start.sh backup`、`start.sh restore` 和 `start.sh data-volume` 由 `scripts/deploy/data.sh` 实现。脚本会优先读取 `liteoj-app` 实际挂载的 `/app/data` volume，避免恢复到错误数据卷。

## 后端模块

- `backend/server.js`：Express 应用、静态资源、API 挂载、全局错误处理。
- `backend/db.js`：SQLite 表结构、迁移、行对象转换。
- `backend/auth.js`：JWT Cookie、登录态解析、权限中间件。
- `backend/security.js`：安全响应头、静态资源缓存、基础限速。
- `backend/problem-config.js`：题目配置枚举和表单值归一化。
- `backend/problem-files.js`：题目目录、测试点、附件、checker.cpp 文件路径。
- `backend/tag-service.js`：统一标签词典、slug 校验、标签关系表同步。
- `backend/settings.js`：站点配置读写，当前用于 AI 对话参数。
- `backend/prelim-utils.js`：CSP 初赛 Markdown 解析和题型归一化。
- `backend/routes/*`：按业务域拆分的 API。

## 前端模块

LiteOJ 前端是无构建步骤的单页应用：

- `frontend/public/index.html`：页面壳和导航。
- `frontend/public/app.js`：前端路由、API 调用、页面渲染和交互。
- `frontend/public/style.css`：全站样式。

编程题库、提交记录、初赛题库、初赛模考、后台题库和初赛题库管理都使用统一分页交互，默认每页 20 条，支持 10/20/50/100 条切换。提交记录由 `/api/submissions?limit=20&page=1` 进行后端分页，其余列表按现有筛选结果在前端切片渲染。

主要页面：

- 公开编程题库：`/problems`
- 编程题详情：`/problem/:id`
- 提交记录：`/submissions`
- 初赛题库：`/prelim`
- 初赛模考：`/prelim/mock`
- 考点分析：`/analytics`
- AI 对话：`/ai`
- 后台：`/admin`
- AI 配置：`/admin/ai`
- 题面编辑：`/admin/problem/:id/edit` 和 `/admin/problem/new`
- 测试数据管理：`/admin/problem/:id/data`

## 数据模型

核心表：

- `users`：账号、bcrypt 密码哈希、角色。
- `problems`：题号、题名、题面、标签、限制、评测模式、公开状态。
- `problem_cases`：测试点文件、子任务名、分值、排序、单点时空限制。
- `submissions`：提交、代码、状态、分数、用时、内存、测试点详情。
- `prelim_*`：初赛试卷、题组、小题、作答记录、模考记录。
- `oj_tags`：统一标签词典。`slug` 是唯一事实来源，`name_zh` 是唯一中文展示名。
- `oj_problem_tags`：编程题与标签的关系。
- `oj_prelim_question_tags`：初赛小题与标签的关系。
- `app_settings`：后台配置项，包含 `ai.*` 配置。
- `ai_sessions`：AI 会话，只按 `user_id` 归属到 LiteOJ 用户账号。
- `ai_messages`：AI 历史消息，只保存 `user` 和 `assistant` 消息正文，不保存长期记忆、摘要或向量数据。

`problems.tags_json` 和 `prelim_questions.tags_json` 仍保留为接口兼容缓存；查询、筛选和数据分析优先使用关系表。

复赛题目无需单独建表，使用编程题库题号承载元数据：`CSPJ25T1` 表示 2025 年 CSP-J 复赛 T1，`CSPS25T4` 表示 2025 年 CSP-S 复赛 T4。复赛分析只统计公开题目，并按标签出现次数分析，不计算考点权重。

题目文件位于 `DATA_DIR/problems/<problemId>/`：

```text
attachments/       题面图片和下载附件
testdata/          .in/.out/.ans 文件
checker.cpp        Special Judge 源文件
```

附件通过 `/api/problems/:id/attachments/:filename` 访问。上传时使用随机临时文件名，落盘后保留安全化后的原始 basename，便于 CSP 复赛大数据包在题面中保持可读链接。

题面 Markdown 在前端渲染，支持 KaTeX、代码块、标准表格、表格 `^` 纵向合并、`:::align{center}` 对齐块和 `::cute-table{tuack}` 样式块。附件图片使用标准 `![说明](url)` 语法，下载附件使用 `[文件名](url)`。

## 编程题工作流

### 新增题目

1. 管理员进入 `/admin/problem/new`。
2. 编辑题号、标题、难度、时空限制、题面、是否启用 Special Judge。
3. 新题默认不公开。
4. 创建成功后自动进入测试数据管理页。
5. 管理员录入测试点、子任务、checker.cpp。
6. 管理员可下载全部/所选测试点，也可批量删除所选测试点。
7. 确认可评测后手动公开题目。

### 提交评测

1. 用户在题目页提交代码。
2. 后端插入 `submissions`，状态为 `Waiting`。
3. judge worker 领取任务并锁定为 `Judging`。
4. 后端只返回测试点元数据，输入和输出由 worker 按 case 拉取或从共享数据目录读取。
5. go-judge 编译用户程序。
6. 按测试点运行，超时立即返回 TLE。
7. 标准题使用内置标准输出比较。
8. SPJ 题在用户程序运行成功后调用 checker。
9. runner 按测试点或子任务规则汇总分数。
10. judge worker 写回结果；写回必须匹配当前 `judge_id` 锁，避免超时 worker 覆盖新结果。

如果 worker 崩溃或网络中断，`Judging` 状态且 `locked_at` 超过 `JUDGE_LOCK_TIMEOUT_SECONDS` 的提交会在下一次领取任务时自动回收为 `Waiting`。

## 计分模型

LiteOJ 使用一种统一模型：

- 无子任务：每个测试点有自己的分值，通过即得分。
- 有子任务：每个子任务有一个总分，组内所有测试点通过才得该子任务分。
- 子任务内分值在数据库中存放在该组第一个测试点上，其余测试点为 0；展示和编辑时按组汇总。

这种模型与 CMS 的 `GroupMin` / 子任务分组思想一致：组内任一测试点失败，整组不得分。

## Special Judge

题目启用 `special_judge` 后，需要提供 `checker.cpp`。

runner 会：

1. 使用 go-judge 编译 `checker.cpp` 和 vendored `judge/testlib.h`；
2. 编译用户程序；
3. 对每个测试点运行用户程序；
4. 若用户程序未 RE/TLE/MLE/OLE，则运行 checker；
5. checker 退出码 0 视为 AC，其他普通失败视为 WA，checker 编译或运行系统错误视为 System Error。

checker 参数顺序：

```text
argv[1] = input.txt
argv[2] = output.txt   # 用户输出
argv[3] = answer.txt   # 标准输出
```

testlib 中 `registerTestlibCmd(argc, argv)` 会据此初始化 `inf`、`ouf`、`ans`。

## API 分组

- `/api/auth`：账号登录态。
- `/api/profile`：个人资料和改密。
- `/api/admin`：后台统计和用户角色。
- `/api/problems`：编程题、附件、checker、测试点、提交入口。
- `/api/submissions`：提交列表、详情和重测。
- `/api/judge`：judge worker 内部接口。
- `/api/prelim`：初赛题库、导入、模考。
- `/api/analytics`：初赛/复赛考点统计；初赛来自 `prelim_*`，复赛来自公开编程题库和复赛题号解析。
- `/api/tags`：标签列表、大纲树和 slug 校验。
- `/api/ai`：登录用户的 AI 会话和流式消息接口。所有会话接口按当前 `user_id` 校验所有权。

具体接口清单见 README。

## 安全边界

- Web 容器不直接执行用户代码。
- go-judge 只绑定本机回环地址。
- judge worker 通过 `JUDGE_TOKEN` 调用内部接口。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`，HTTPS 下自动 `Secure`。
- 密码使用 bcrypt，保留一次性明文密码迁移兼容。
- 提交入口限制代码大小、提交频率、单用户待评测数量和全局队列数量。
- 上传测试数据限制 zip 大小和解压总量；手动测试点、附件和单题总存储也有限制。
- `checker.cpp` 有源码大小限制，运行有独立时空限制。
- AI 对话 API Key 只从服务端环境变量读取。讯飞星辰使用 `XFYUN_API_KEY`，DeepSeek 使用 `DEEPSEEK_API_KEY`；前端只能看到是否已配置 key，不能读取 key 内容。
- AI 会话不接入题库、提交记录或标签分析，上游模型请求只发送系统提示词和当前会话上下文。
- AI 助教模式使用两段提示词：首次提示词随用户消息和最近上下文发送；启用二次审查时，首次回复会在服务端缓冲，再用“二次审查提示词 + 首次回复”单独调用上游模型，不携带上下文，最终只展示审查后的回复。

## 参考资料

- [go-judge](https://github.com/criyle/go-judge)
- [testlib](https://github.com/MikeMirzayanov/testlib)
- [CMS Score types](https://cms.readthedocs.io/en/v1.5/Score%20types.html)
- [Express static files](https://expressjs.com/en/starter/static-files.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
