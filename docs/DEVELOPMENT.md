# LiteOJ 开发文档

更新时间：2026-06-27

## 本地环境

要求：

- Node.js 22
- npm 10
- Docker / Docker Compose
- gcc / g++ / python3

安装依赖：

```bash
npm install
npm run init
```

启动 Web：

```bash
npm start
```

启动 go-judge：

```bash
docker compose up -d --build go-judge
```

启动 judge worker：

```bash
GO_JUDGE_URL=http://127.0.0.1:5050 npm run judge
```

## 测试命令

```bash
npm run check       # 所有 JS 文件语法检查
npm run smoke       # 静态 smoke：关键字符串、路由和模块约束
npm run real-smoke  # 启动临时服务并测试真实 API
npm test            # check + smoke + real-smoke
docker compose config
git diff --check
```

SPJ 链路可在 go-judge 正常运行时通过 `judgeTask` 直接验证，`scripts/smoke-test.js` 已检查 `compileChecker`、`runChecker` 和 vendored `testlib.h` 存在。

## 代码组织

```text
backend/
  auth.js              JWT Cookie 和权限
  db.js                SQLite schema + migration
  passwords.js         bcrypt 封装
  problem-config.js    题目配置归一化
  problem-files.js     题目文件路径和读写
  prelim-utils.js      初赛 Markdown 解析
  routes/              Express 路由
frontend/public/
  app.js               SPA 路由和页面渲染
  style.css            样式
judge/
  worker.js            轮询后端
  runner.js            编译、运行、计分
  go-judge-client.js   go-judge /run 适配
  languages.js         语言配置
  testlib.h            SPJ checker 编译依赖
scripts/
  init.js              初始化数据库和种子数据
  reset-admin.js       管理员恢复
  real-smoke-test.js   真实 API 测试
  smoke-test.js        静态烟测
scripts/deploy/
  data.sh              数据卷识别、备份和恢复
  services.sh          app/go-judge/judge worker 生命周期
  docker.sh            Docker 安装、镜像源和 go-judge 二进制准备
```

## 数据库迁移

所有表结构在 `backend/db.js` 中维护。

规则：

- 新表写入 `CREATE TABLE IF NOT EXISTS`。
- 新列通过 `ensureColumn` 补齐。
- `scripts/init.js` 和 `backend/server.js` 都会调用迁移。
- 不要写破坏性迁移。
- 新增字段后同步 `problemFromRow`、`caseFromRow` 或 `submissionFromRow`。

## API 约定

- JSON API 错误统一返回 `{ error: string }`。
- 管理接口使用 `requireAdmin`。
- 登录接口和注册接口使用基础 IP 限速。
- judge 内部接口使用 `x-judge-token`。
- `/api/judge/acquire` 只返回测试点元数据；测试点正文通过 `/api/judge/cases/:caseId/:kind` 按需读取。
- 题目 ID 必须满足大写字母 + 数字，例如 `P1001`、`ABC12`。
- 复赛题目可使用 `CSPJ25T1` / `CSPS25T4`，其中 `25` 表示 2025 年，`T1`~`T4` 表示复赛题位。

新增 API 时需要：

1. 在 `backend/routes/*` 添加路由；
2. 在 README 的 API 清单中补充；
3. 在 `scripts/smoke-test.js` 添加关键路由断言；
4. 如涉及真实链路，补 `scripts/real-smoke-test.js`。

新增 `start.sh` 运维命令时需要：

1. 在 `scripts/deploy/*.sh` 中保持模块化实现；
2. 在 `start.sh` 用简短 action 暴露；
3. 在部署手册和 README 同步用法；
4. 在 `scripts/smoke-test.js` 增加命令存在性或关键字符串断言。

## 编程题开发约定

### 题面

题面是单个 Markdown 字段，支持：

- 标题、列表、表格；
- fenced code block；
- inline code；
- KaTeX；
- 标准 Markdown 表格、表格对齐行和 `^` 向上合并；
- `:::align{center}` 对齐块；
- `::cute-table{tuack}` 样式化表格块；
- 图片和下载附件。

新增题目流程是先写题面，再进入测试数据管理页。

前端 Markdown 渲染器在 `frontend/public/app.js` 中实现。它会修复预览里常见的拆行图片/链接语法，例如 `![a]\n(/api/...)` 会按 `![a](/api/...)` 渲染。题面附件由 `/api/problems/:id/attachments` 上传，最终文件名由 `sanitizeAttachmentFileName()` 安全化后保留原上传 basename，临时文件名才使用随机前缀。

### 测试数据

后端不在题目编辑页处理测试数据。测试数据集中由 `/admin/problem/:id/data` 管理。

测试点字段：

- `input_path`
- `output_path`
- `subtask`
- `score`
- `sort`
- `time_limit`
- `memory_limit`

zip 导入规则：

- 支持 `.in + .out`；
- 支持 `.in + .ans`；
- zip 中 `checker.cpp` 会保存为题目级 Special Judge；
- 当前 UI 的子任务模式开启时，导入测试点默认放入 `子任务1`。

容量限制由 `.env` 控制：`TESTDATA_ZIP_LIMIT`、`TESTDATA_UNZIPPED_LIMIT`、`MANUAL_CASE_LIMIT`、`ATTACHMENT_FILE_LIMIT`、`PROBLEM_STORAGE_LIMIT` 和 `CHECKER_SOURCE_LIMIT`。

### 子任务

子任务只关心整组分值。

数据库中为了兼容现有提交详情，子任务分值存储在该组排序最前的测试点上，其余测试点分值为 0。前端展示时按组汇总，runner 计分时按组求和。

## Judge 开发约定

`judge/runner.js` 不直接执行进程，不使用 `child_process`。所有编译/运行都走 `judge/go-judge-client.js`。

执行阶段：

1. worker 领取 `Waiting` 提交并写入 `Judging` 锁；
2. runner 按测试点从共享目录或后端 case 文件接口读取输入/输出；
3. 编译 checker.cpp，若题目启用 SPJ；
4. 编译用户代码；
5. 逐测试点运行用户程序；
6. 用户程序成功后运行 checker；
7. 汇总分数；
8. worker 带 `judgeId` 写回结果，后端只接受仍匹配当前锁的结果。

`JUDGE_LOCK_TIMEOUT_SECONDS` 控制 `Judging` 任务的超时回收。worker 崩溃后，下一次 `/api/judge/acquire` 会把过期锁恢复为 `Waiting`。

go-judge result 被归一化为：

- `code`
- `stdout`
- `stderr`
- `timeMs`
- `memoryKb`
- `timeout`
- `memoryLimitExceeded`
- `outputLimitExceeded`
- `systemError`

### 添加语言

在 `judge/languages.js` 中添加：

```js
{
  source: 'main.ext',
  executable: 'main',
  compile: () => ({ command: '...', args: [...] }),
  run: () => ({ command: './main', args: [] }),
}
```

同时更新：

- 前端 `SUBMISSION_LANGUAGES`；
- 后端 `/submit` 允许语言列表；
- README 和使用手册。

## Special Judge 开发

checker 约定：

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    // inf: input
    // ouf: contestant output
    // ans: answer
    quitf(_ok, "ok");
}
```

LiteOJ 编译：

```text
g++ checker.cpp -O2 -std=c++17 -DONLINE_JUDGE -I. -o checker
```

LiteOJ 运行：

```text
./checker input.txt output.txt answer.txt
```

checker 退出码：

- `0`：Accepted；
- 普通非零：Wrong Answer；
- checker 编译失败、超时、内存超限、系统错误：System Error。

## 初赛题库开发

初赛数据由 `seed/prelim/*.md` 初始化，也可后台导入。标准卷面和解析格式见 `docs/PRELIM_IMPORT_TEMPLATE.md`。

导入要求：

- 上传试卷 Markdown；
- 上传答案解析 Markdown；
- 可先预览再导入；
- 可选择替换同年份/组别/轮次。

解析逻辑在 `backend/prelim-utils.js`。修改解析规则后必须跑：

```bash
npm run smoke
npm run real-smoke
```

答案解析中的标签必须使用固定 slug 格式：

```md
**考点与权重：** language-basics: 70%, bitwise: 30%
```

解析规则：

- `slug` 只能来自 `seed/tag-schema.json`；
- 权重写成数字，可带 `%`；
- 多个标签用英文逗号、中文逗号、分号或中文分号分隔；
- 不识别中文名、别名或自由文本。遇到未知 slug 时导入直接失败。

## 标签系统开发

统一标签词典位于 `seed/tag-schema.json`。

规则：

- `slug` 是唯一稳定 ID；
- `nameZh` 是唯一中文展示名；
- 编程题编辑页只提交 slug；
- 初赛导入后同步 `oj_prelim_question_tags`；
- 编程题保存后同步 `oj_problem_tags`。

新增标签时优先追加到 `seed/tag-schema.json`，不要直接把自由文本写入题目数据。

## 数据分析规则

`/api/analytics/knowledge` 按 `roundName` 分流：

- `初赛`：复用 `/api/analytics/prelim/knowledge`，使用初赛题库数据；
- `复赛`：使用公开编程题库中符合 `CSPJ25T1` / `CSPS25T1` 规则的题目。

初赛分析计算：

- 考点出现次数：每小题内去重后计数；
- 加权分值：按 canonical slug 聚合；一个考点得满分，两个及以上考点取权重最高的两个；
- 权重缺失或全为 0 时平均分配；
- 结果按年份和组别筛选。

复赛分析计算：

- 年份、组别、题位从题号解析；
- 不使用标签权重，只统计标签出现次数；
- 输出 T1-T4 题位画像、难度分布、题位/考点热力表和题目明细。

## AI 对话开发

AI 对话接口位于 `backend/routes/ai.js`，配置读写位于 `backend/settings.js`。

- API Key 只从服务端环境变量读取：讯飞星辰使用 `XFYUN_API_KEY`，DeepSeek 使用 `DEEPSEEK_API_KEY`；
- 默认服务商为讯飞星辰，OpenAI 格式 base URL 为 `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2`；
- 默认模型为讯飞星辰 Qwen3.6-35B-A3B（`xopqwen36v35b`），后续可在后台切换到 DeepSeek 的 `deepseek-v4-flash`；
- 会话和消息必须按当前 `user_id` 过滤；
- `ai.context_mode=none` 时只发送 system prompt 和当前用户消息；
- `ai.context_mode=recent` 时发送 system prompt、当前会话最近 N 条历史消息和当前用户消息；
- 数据库只保存 `user` / `assistant` 历史消息，不增加摘要、长期记忆或向量数据库。
- `ai.block_full_code=true` 且命中明显代写请求时，优先直接返回 LiteOJ 拦截模板，不调用上游模型。
- 正常粘贴题面不做硬拦截；只有 `looksLikeFullCodeRequest()` 命中索要代码意图时才固定回复并跳过上游。
- `sanitizeFullCodeOutput()` 会在上游回复完成后检查完整 `main` 程序、超长代码块和“复制提交”式内容；命中时只把对应代码片段替换为“隐藏完整代码”，保留其余解释。
- 代写拦截开启时不要把上游 token 逐字流给前端，必须先缓冲审查，再发送最终安全内容；等待期间通过 SSE `stage` 事件展示“用户请求分析中 / 小轻思考中 / 小轻回复审查中”。

## 前端开发约定

- 不引入构建步骤。
- 路由集中在 `render()`。
- 页面渲染函数使用 `renderXxx` 命名。
- 表单提交统一走 `api()` 或 `fetch + FormData`。
- 列表页默认每页 20 条。新增列表优先复用 `DEFAULT_PAGE_SIZE`、`paginateItems()`、`renderPagination()` 和 `.pagination-bar`，筛选时保留当前 `pageSize` 并回到第一页。
- 数据量会持续增长的列表优先做后端分页；提交记录 `/api/submissions` 已支持 `limit`、`page`、`total`。
- 管理测试数据时不加载测试点正文，避免大数据卡顿。
- SPJ、测试点、子任务管理都在测试数据管理页完成。

## 文档维护

变更以下内容必须同步文档：

- API；
- 环境变量；
- 评测流程；
- 题目/测试数据/初赛导入流程；
- 安全边界；
- 部署脚本行为。

## 参考资料

- [Express routing](https://expressjs.com/en/guide/routing.html)
- [go-judge](https://github.com/criyle/go-judge)
- [testlib](https://github.com/MikeMirzayanov/testlib)
- [CMS Score types](https://cms.readthedocs.io/en/v1.5/Score%20types.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
