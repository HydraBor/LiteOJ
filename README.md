# LiteOJ

LiteOJ 是一个面向信奥训练的轻量在线评测系统，包含编程题库、go-judge 评测、testlib 风格 Special Judge、CSP-J/S 初赛题库、初赛模考和考点数据分析。

当前版本：`1.4.4`

## 核心功能

- 账号系统：注册、登录、退出、个人改密、管理员角色。
- 编程题库：题目列表、题面详情、代码提交、提交记录、重测。
- 题面编辑：Markdown + KaTeX + 代码高亮 + 表格合并 + 对齐块 + 图片/下载附件。
- 题目管理：新增、编辑、隐藏/公开、复制、删除；新增题目默认隐藏。
- 测试数据：zip 导入 `.in/.out` 或 `.in/.ans`，手动录入测试点，下载全部/所选测试点，批量删除，测试点独立时空限制。
- 评分模型：普通测试点按点得分；子任务按整组得分，组内测试点全部通过才获得该子任务分值。
- Special Judge：上传 `checker.cpp`，使用 vendored `judge/testlib.h` 编译，参数顺序为 `input output answer`。
- 评测执行：Web 与任务调度由 LiteOJ 负责，用户程序和 checker 编译运行全部交给 go-judge。
- 语言：C11、C++11、C++14、C++17、Python 3；提交页默认 C++14，非 C++ 不显示 O2。
- 初赛题库：支持单选、判断、阅读程序、完善程序，内置 CSP-J1 2019-2025 种子数据。
- 初赛模考：从初赛题库生成试卷，提交后展示分数和报告。
- 统一标签：`slug` 是唯一存储标识，中文名是唯一展示名；导入与编程题选标签都只接受固定表中的 slug。
- 数据分析：按组别、场次、年份统计 canonical 考点；复赛支持 T1-T4 题位、难度和热力图分析。
- 你好小轻：登录用户可新建、重命名、删除自己的小轻会话；默认使用讯飞星辰 OpenAI 格式接口，后台可切换 DeepSeek，历史只保存会话消息，并带有索要代码意图拦截、完整代码隐藏和等待阶段提示。

复赛题目可使用 `CSPJ25T1`、`CSPS25T4` 这类题号，表示 2025 年 CSP-J/S 复赛第 1/4 题。复赛分析会自动从公开编程题库中识别这类题号，并按标签出现次数统计，不计算考点权重。

## 快速开始

推荐在 Ubuntu 24.04 LTS 服务器上直接执行：

```bash
git clone <your-repo-url> LiteOJ
cd LiteOJ
chmod +x ./start.sh
./start.sh
```

脚本会准备 `.env`、Docker、Docker Compose、portable Node.js、go-judge 二进制、国内镜像源和宿主机 judge worker。启动后访问：

```text
http://127.0.0.1:3000
```

默认管理员：

```text
admin / admin123
```

备份、恢复、清空用户数据、清空编程题库和清空初赛题库的脚本命令见 [部署手册](docs/DEPLOYMENT.md)。

已有数据库不会因为 `.env` 中的 `ADMIN_PASSWORD` 改动而重置管理员密码。需要强制恢复时执行：

```bash
docker compose exec app npm run reset-admin -- admin admin123
```

## 启动命令

```bash
./start.sh          # 启动 app + go-judge + 宿主机 judge worker
./start.sh status   # 查看容器和 judge worker 状态
./start.sh logs     # 查看日志
./start.sh restart  # 重启
./start.sh stop     # 停止
./start.sh install  # 仅安装/准备运行依赖
./start.sh backup   # 备份 Docker 数据卷到 backups/
./start.sh restore backups/liteoj-data-YYYYMMDD-HHMMSS.tgz
./start.sh data-volume  # 查看当前项目真实使用的数据卷
```

默认端口：

- Web: `PORT=3000`，Docker 默认只发布到 `127.0.0.1`
- go-judge: `GO_JUDGE_PORT=5050`，只绑定 `127.0.0.1`

直接运行 `npm start` 时 Web 默认监听 `127.0.0.1`；Docker Compose 内部会让容器进程监听 `0.0.0.0`，但宿主机端口仍只发布到 `127.0.0.1`，适合交给 Caddy/Nginx 反代。

若端口被占用，`start.sh` 会在配置范围内自动寻找下一个可用端口，并写回 `.env`。

## 本地开发

```bash
npm install
npm run init
npm start
```

另开终端启动 judge worker：

```bash
npm run judge
```

开发机需要能访问 go-judge。最简单方式是：

```bash
docker compose up -d --build go-judge
GO_JUDGE_URL=http://127.0.0.1:5050 npm run judge
```

## 评测模型

1. 用户提交代码后，提交状态为 `Waiting`。
2. judge worker 通过 `/api/judge/acquire` 领取任务。
3. 后端只下发测试点元数据；worker 按测试点通过 `/api/judge/cases/:caseId/:kind` 拉取输入/输出，避免大数据一次性塞进任务 JSON。
4. `judge/go-judge-client.js` 调用 go-judge `/run` 编译和运行用户程序。
5. 若题目启用 Special Judge，先编译 `checker.cpp`，再对每个通过运行阶段的测试点执行 checker。
6. `judge/runner.js` 汇总测试点结果并按普通测试点或子任务规则计分。
7. judge worker 带本次锁标识通过 `/api/judge/:id/result` 写回结果；超时未写回的 `Judging` 任务会被自动回收为 `Waiting`。

Special Judge checker 使用 testlib 习惯写法：

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    // inf: 输入文件，ouf: 用户输出，ans: 标准输出
    quitf(_ok, "ok");
}
```

`checker.cpp` 可以在测试数据管理页单独上传，也可以放进测试数据 zip 根目录一并上传。

## 主要 API

账号：

- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/profile/password`

编程题：

- `GET /api/problems`
- `GET /api/problems/facets`
- `GET /api/problems/next-id`
- `POST /api/problems`
- `POST /api/problems/batch`
- `GET /api/problems/:id`
- `PUT /api/problems/:id`
- `PATCH /api/problems/:id/status`
- `POST /api/problems/:id/status`
- `POST /api/problems/:id/clone`
- `DELETE /api/problems/:id`
- `POST /api/problems/:id/submit`
- `POST /api/problems/:id/rejudge`

题目资源：

- `POST /api/problems/:id/attachments`
- `GET /api/problems/:id/attachments/:filename`
- `GET /api/problems/:id/checker`
- `POST /api/problems/:id/checker`
- `DELETE /api/problems/:id/checker`

测试数据：

- `GET /api/problems/:id/cases`
- `GET /api/problems/:id/cases/download`
- `GET /api/problems/:id/cases/:caseId`
- `POST /api/problems/:id/cases`
- `POST /api/problems/:id/cases/zip`
- `PUT /api/problems/:id/cases/bulk`
- `PUT /api/problems/:id/cases/:caseId`
- `DELETE /api/problems/:id/cases`
- `DELETE /api/problems/:id/cases/:caseId`

提交：

- `GET /api/submissions?limit=20&page=1`
- `GET /api/submissions/:id`
- `POST /api/submissions/:id/rejudge`

初赛题库、模考和数据分析：

- `GET /api/prelim/papers`
- `GET /api/prelim/facets`
- `GET /api/prelim/items`
- `GET /api/prelim/items/:id`
- `GET /api/prelim/questions`
- `GET /api/prelim/questions/:id`
- `GET /api/prelim/papers/:id`
- `POST /api/prelim/questions/:id/check`
- `POST /api/prelim/import-md`
- `DELETE /api/prelim/papers/:id`
- `POST /api/prelim/items/:id/status`
- `GET /api/prelim/mock/papers`
- `POST /api/prelim/mock/start`
- `GET /api/prelim/mock/exams/:id`
- `POST /api/prelim/mock/exams/:id/submit`
- `GET /api/prelim/mock/exams/:id/report`
- `GET /api/analytics/prelim/options`
- `GET /api/analytics/prelim/knowledge`
- `GET /api/analytics/options`
- `GET /api/analytics/knowledge`

标签：

- `GET /api/tags`
- `GET /api/tags/tree`
- `GET /api/tags/resolve`

你好小轻：

- `GET /api/ai/config`
- `GET /api/ai/sessions`
- `POST /api/ai/sessions`
- `GET /api/ai/sessions/:id`
- `PATCH /api/ai/sessions/:id`
- `DELETE /api/ai/sessions/:id`
- `POST /api/ai/sessions/:id/messages`

后台和 judge：

- `GET /api/admin/stats`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/role`
- `POST /api/admin/users/:id/reset-password`
- `GET /api/admin/ai-settings`
- `PUT /api/admin/ai-settings`
- `POST /api/judge/acquire`
- `GET /api/judge/cases/:caseId/:kind`
- `POST /api/judge/:id/result`

## 项目结构

```text
backend/                 Express API、SQLite 迁移、鉴权和业务路由
frontend/public/         单页前端、页面渲染和样式
judge/                   judge worker、go-judge client、计分和 testlib.h
scripts/                 初始化、测试、管理员恢复和部署脚本
scripts/deploy/          start.sh 的模块化实现
seed/                    示例编程题和 CSP 初赛种子数据
seed/tag-schema.json     统一标签词典
docs/                    架构、部署、开发、使用、初赛导入模板和收尾文档
Dockerfile               Web / host judge 共用镜像
Dockerfile.go-judge      go-judge 镜像
docker-compose.yml       app、go-judge、可选 container-judge
start.sh                 统一启动入口
```

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [部署手册](docs/DEPLOYMENT.md)
- [开发文档](docs/DEVELOPMENT.md)
- [使用手册](docs/USER_MANUAL.md)
- [收尾检查](docs/FINAL_REVIEW.md)

## 安全边界

- `JWT_SECRET` 和 `JUDGE_TOKEN` 在生产环境必须使用强随机值。
- 登录和注册有内存级限速。
- 提交代码有大小、频率、单用户待评测数量和全局队列数量限制。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`，HTTPS 请求下自动启用 `Secure`。
- API 响应禁用缓存，静态资源使用短缓存。
- go-judge 端口默认只绑定到 `127.0.0.1`。
- 不要把 Docker socket 挂载进 Web 容器。
- 测试数据 zip 有上传大小和解压总量限制，手动测试点、附件、单题总存储和 checker.cpp 都有容量限制。

## 参考资料

- [go-judge](https://github.com/criyle/go-judge)
- [testlib](https://github.com/MikeMirzayanov/testlib)
- [CMS Score types](https://cms.readthedocs.io/en/v1.5/Score%20types.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Docker Compose documentation](https://docs.docker.com/compose/)
