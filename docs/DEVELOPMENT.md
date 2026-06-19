# LiteOJ 开发文档

更新时间：2026-06-19

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
- 题目 ID 必须满足大写字母 + 数字，例如 `P1001`、`ABC12`。

新增 API 时需要：

1. 在 `backend/routes/*` 添加路由；
2. 在 README 的 API 清单中补充；
3. 在 `scripts/smoke-test.js` 添加关键路由断言；
4. 如涉及真实链路，补 `scripts/real-smoke-test.js`。

## 编程题开发约定

### 题面

题面是单个 Markdown 字段，支持：

- 标题、列表、表格；
- fenced code block；
- inline code；
- KaTeX；
- 图片附件。

新增题目流程是先写题面，再进入测试数据管理页。

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

### 子任务

子任务只关心整组分值。

数据库中为了兼容现有提交详情，子任务分值存储在该组排序最前的测试点上，其余测试点分值为 0。前端展示时按组汇总，runner 计分时按组求和。

## Judge 开发约定

`judge/runner.js` 不直接执行进程，不使用 `child_process`。所有编译/运行都走 `judge/go-judge-client.js`。

执行阶段：

1. 编译 checker.cpp，若题目启用 SPJ；
2. 编译用户代码；
3. 逐测试点运行用户程序；
4. 用户程序成功后运行 checker；
5. 汇总分数。

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

初赛数据由 `seed/prelim/*.md` 初始化，也可后台导入。

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

## 数据分析规则

`/api/analytics/prelim/knowledge` 使用当前题库数据计算：

- 考点出现次数：每小题内去重后计数；
- 加权分值：一个考点得满分，两个及以上考点取权重最高的两个；
- 权重缺失或全为 0 时平均分配；
- 结果按年份和组别筛选。

## 前端开发约定

- 不引入构建步骤。
- 路由集中在 `render()`。
- 页面渲染函数使用 `renderXxx` 命名。
- 表单提交统一走 `api()` 或 `fetch + FormData`。
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
