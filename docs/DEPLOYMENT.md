# LiteOJ 部署手册

更新时间：2026-06-27

## 推荐环境

- Ubuntu 24.04 LTS
- 非 root 用户，可使用 sudo
- 2 核 CPU / 2 GB 内存以上
- 10 GB 以上磁盘
- 可访问 GitHub release、Docker 镜像源和 npm 镜像源

LiteOJ 的部署入口是：

```bash
./start.sh
```

## 一键启动

```bash
git clone <your-repo-url> LiteOJ
cd LiteOJ
chmod +x ./start.sh
./start.sh
```

脚本会执行：

1. 创建或补齐 `.env`；
2. 配置 apt、npm、Docker 构建镜像源；
3. 安装或检查 Docker / Docker Compose；
4. 准备 portable Node.js 22；
5. 下载 go-judge 二进制到 `.runtime/go-judge/go-judge`；
6. 构建并启动 `liteoj-app` 和 `liteoj-go-judge`；
7. 在宿主机启动 judge worker。

启动完成后查看：

```bash
./start.sh status
./start.sh logs
```

## 常用运维命令

```bash
./start.sh              # 启动
./start.sh restart      # 重启
./start.sh stop         # 停止 app/go-judge/judge worker
./start.sh status       # 状态
./start.sh logs         # app 容器日志 + judge 日志
./start.sh install      # 只准备依赖
./start.sh backup       # 备份数据卷和 .env 到 backups/
./start.sh restore backups/liteoj-data-YYYYMMDD-HHMMSS.tgz
./start.sh data-volume  # 查看当前项目真实使用的数据卷
```

## 端口

`.env` 默认：

```dotenv
PORT=3000
GO_JUDGE_PORT=5050
LITEOJ_AUTO_PORT=1
LITEOJ_PORT_SCAN_END=3099
LITEOJ_GO_JUDGE_PORT_SCAN_END=5099
```

若 `PORT` 或 `GO_JUDGE_PORT` 被占用，脚本会自动扫描后续端口并写回 `.env`。若希望端口冲突时直接报错：

```dotenv
LITEOJ_AUTO_PORT=0
```

## 国内网络

`.env` 默认使用国内镜像：

```dotenv
NPM_REGISTRY=https://registry.npmmirror.com
DOCKER_BUILD_APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
DOCKER_BUILD_APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
LITEOJ_APT_MIRROR=1
GO_JUDGE_RELEASE_BASE=https://github.com/criyle/go-judge/releases/download
```

如服务器无法访问 GitHub release，可提前把对应版本的 go-judge Linux amd64 二进制放到：

```text
.runtime/go-judge/go-judge
```

并赋权：

```bash
chmod +x .runtime/go-judge/go-judge
```

## sudo 与 Docker 权限

`start.sh` 会优先使用当前用户可用的 Docker；若需要 sudo，会调用 sudo。首次安装 Docker 后，当前用户可能需要重新登录才能免 sudo 使用 Docker。

如果你希望手动处理 Docker 权限：

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker info
```

## 环境变量

关键变量：

```dotenv
JWT_SECRET=replace-with-long-random-string
JUDGE_TOKEN=replace-with-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
COOKIE_SECURE=auto
XFYUN_API_KEY=
DEEPSEEK_API_KEY=
```

评测变量：

```dotenv
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_LOCK_TIMEOUT_SECONDS=600
JUDGE_MAX_OUTPUT_BYTES=16777216
GO_JUDGE_URL=http://127.0.0.1:5050
GO_JUDGE_PROCESS_LIMIT=64
SPJ_TIMEOUT_MS=3000
SPJ_MEMORY_LIMIT_MB=256
```

上传限制：

```dotenv
TESTDATA_ZIP_LIMIT=50
TESTDATA_UNZIPPED_LIMIT=200
ATTACHMENT_FILE_LIMIT=200
CHECKER_SOURCE_LIMIT=1
MANUAL_CASE_LIMIT=5
PROBLEM_STORAGE_LIMIT=500
MAX_CODE_SIZE_KB=128
SUBMIT_RATE_LIMIT=20
SUBMIT_RATE_WINDOW_SECONDS=60
MAX_PENDING_SUBMISSIONS_PER_USER=20
MAX_JUDGE_QUEUE=500
```

单位说明：

- `TESTDATA_ZIP_LIMIT`：MB，zip 原始文件大小。
- `TESTDATA_UNZIPPED_LIMIT`：MB，zip 解压后总大小。
- `ATTACHMENT_FILE_LIMIT`：MB，题面附件单文件大小，默认用于 CSP 复赛数据包等下载附件。
- `CHECKER_SOURCE_LIMIT`：MB，checker.cpp 源码大小。
- `MANUAL_CASE_LIMIT`：MB，手动录入单个输入或输出的大小。
- `PROBLEM_STORAGE_LIMIT`：MB，单题测试数据、附件和 checker 的总容量。
- `MAX_CODE_SIZE_KB`：KB，单次提交代码大小。
- `SUBMIT_RATE_LIMIT` / `SUBMIT_RATE_WINDOW_SECONDS`：单用户提交频率限制。
- `MAX_PENDING_SUBMISSIONS_PER_USER`：单用户最多同时处于 Waiting/Judging 的提交数。
- `MAX_JUDGE_QUEUE`：全站最多同时处于 Waiting/Judging 的提交数。
- `JUDGE_LOCK_TIMEOUT_SECONDS`：`Judging` 任务超时未回写后自动回收为 `Waiting` 的时间。
- `SPJ_TIMEOUT_MS`：毫秒，checker 单次运行时间。
- `JUDGE_MAX_OUTPUT_BYTES`：字节，用户程序单个测试点标准输出采集上限，默认 16 MiB。
- `SPJ_MEMORY_LIMIT_MB`：MB，checker 单次运行内存。

AI 对话变量：

- `XFYUN_API_KEY`：讯飞星辰 API Key，只在服务端环境变量中读取，不写入前端。
- `DEEPSEEK_API_KEY`：DeepSeek API Key，在后台切换到 DeepSeek 或选择 DeepSeek 审查时使用。
- 密钥不要写入仓库、提示词或后台表单；只写入服务器的 `.env`。`.env.example` 必须保持空值。
- 主模型、审查模型所需 key 均未配置时 `/ai` 页面可打开，但不能发送消息。DeepSeek 主 key 缺失而讯飞 key 可用且已开启降级时，可直接由讯飞接续。

AI 功能开关、默认模型、每日次数、输入长度、输出 token、历史空间上限、上下文模式和最近消息数在“后台管理 -> AI 配置”中保存到数据库：

- `ai.enabled`
- `ai.provider`，默认 `xfyun`
- `ai.xfyun_base_url` / `ai.xfyun_model`
- `ai.deepseek_base_url` / `ai.deepseek_model`，DeepSeek 默认 `https://api.deepseek.com` / `deepseek-v4-flash`
- `ai.deepseek_thinking_enabled`，全局控制 DeepSeek 思考模式；开启时推理强度为 `high`
- `ai.fallback_to_xfyun`，DeepSeek 故障时单向使用讯飞备用服务
- `ai.max_requests_per_user_per_day`
- `ai.max_input_chars`
- `ai.max_output_tokens`
- `ai.max_history_mb_per_user`，默认每用户 `5` MB
- `ai.context_mode`，取值 `none` 或 `recent`
- `ai.context_recent_messages`，默认 `6`
- `ai.system_prompt`
- `ai.review_enabled`
- `ai.review_provider`，取值 `xfyun`、`deepseek` 或 `same`
- `ai.review_model`
- `ai.review_prompt`

`ai.base_url` 和 `ai.default_model` 仅保留为旧版本兼容字段。新版本切换服务商时不会覆盖另一服务商的配置。

## 管理员账号

新数据库会使用 `.env` 中的：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

已有数据库不会在每次启动时重置密码。忘记管理员密码时执行：

```bash
docker compose exec app npm run reset-admin -- admin admin123
```

## Docker Compose 手动部署

仅推荐熟悉 Docker 的开发/运维使用：

```bash
cp .env.example .env
# 修改 JWT_SECRET / JUDGE_TOKEN / ADMIN_PASSWORD
docker compose up -d --build app go-judge
```

宿主机 judge worker：

```bash
source .env
BACKEND_URL=http://127.0.0.1:${PORT:-3000} \
GO_JUDGE_URL=http://127.0.0.1:${GO_JUDGE_PORT:-5050} \
JUDGE_TOKEN="$JUDGE_TOKEN" \
npm run judge
```

可信本地环境也可以使用容器内 judge：

```bash
docker compose --profile container-judge up -d --build
```

`docker-compose.yml` 默认把 Web 端口发布到 `127.0.0.1:${PORT:-3000}`。公网部署时推荐只让 Caddy / Nginx / Traefik 访问该本机端口，不要把 `3000` 直接暴露到外网。

容器内的 Node 进程会监听 `HOST=0.0.0.0`，这是为了让 Docker 端口转发能访问容器；安全边界在宿主机端口发布规则。若不使用 Docker、直接在宿主机运行 `npm start`，LiteOJ 默认监听 `127.0.0.1:${PORT:-3000}`，也可以显式设置：

```bash
HOST=127.0.0.1 PORT=3000 npm start
```

## 反向代理

推荐使用 Nginx/Caddy/Traefik 提供 HTTPS，并反代到 LiteOJ Web 端口。HTTPS 下 `COOKIE_SECURE=auto` 会自动给 Cookie 加 `Secure`。

Nginx 示例：

```nginx
server {
    listen 80;
    server_name oj.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name oj.example.com;

    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Caddy 示例：

```caddyfile
oj.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

不要反代或暴露 `GO_JUDGE_PORT`。

## 备份、恢复与清空 Docker 数据

LiteOJ 的持久数据位于 Docker volume。不要手写某个看起来像项目数据卷的名字：Compose project name 不同时，真实 volume 名也会不同；如果写错，Docker 会自动创建一个空的新 volume，恢复命令看起来成功但网站数据不会变化。

先用脚本确认当前项目实际使用的数据卷：

```bash
./start.sh data-volume
```

数据内容包括：

- `liteoj.db`：用户、编程题元数据、初赛题库、提交记录、模考记录；
- `problems/<problemId>/testdata`：编程题测试数据；
- `problems/<problemId>/attachments`：题面图片和下载附件；
- `problems/<problemId>/checker.cpp`：Special Judge 源文件。

### 全量备份

建议停机备份，避免 SQLite 正在写入时生成不一致快照：

```bash
./start.sh backup
```

备份会写入 `backups/liteoj-data-YYYYMMDD-HHMMSS.tgz`，并同时复制一份 `.env` 到 `backups/liteoj-env-YYYYMMDD-HHMMSS.bak`。如需指定备份目录：

```bash
./start.sh backup /path/to/backups
```

这份备份同时包含编程题库、初赛题库、用户数据、提交记录、题面附件和测试数据。

### 全量恢复

恢复会覆盖当前 volume，请先确认备份文件名。脚本会自动停止服务、清空真实数据卷、解压备份并重新启动：

```bash
ls backups
./start.sh restore backups/liteoj-data-YYYYMMDD-HHMMSS.tgz
```

如果同时恢复 `.env`，请先检查 `JWT_SECRET`、`JUDGE_TOKEN`、端口和管理员密码是否符合当前服务器配置，再执行：

```bash
cp .env ".env.before-restore-$(date +%Y%m%d-%H%M%S)"
cp backups/liteoj-env-YYYYMMDD-HHMMSS.bak .env
chmod 600 .env
./start.sh restart
```

如果你曾经执行过手动恢复命令但“没有作用”，通常是恢复到了错误 volume。可以这样排查：

```bash
./start.sh data-volume
docker volume ls | grep liteoj-data
```

删除误创建的空 volume 前先确认它不是 `./start.sh data-volume` 输出的那个。

### 清空 Docker 数据

完整重置最简单，适合测试服或确认已备份后的重装：

```bash
./start.sh stop
docker compose down -v
./start.sh
```

这会删除所有用户、题目、初赛题库、提交记录、附件、测试数据和 checker。重新启动后，`scripts/init.js` 会再次导入内置示例数据。

### 只清空用户数据

保留编程题库和初赛题库，只删除普通用户、提交记录、初赛练习记录和模考记录，并把默认管理员重置为 `admin / admin123`：

```bash
./start.sh stop
docker compose run --rm --no-deps app node - <<'NODE'
const { db } = require('./backend/db');
const { hashPassword } = require('./backend/passwords');

const username = 'admin';
const password = 'admin123';

db.transaction(() => {
  db.prepare('DELETE FROM submissions').run();
  db.prepare('DELETE FROM prelim_attempts').run();
  db.prepare('DELETE FROM prelim_mock_exams').run();
  db.prepare('DELETE FROM users WHERE username <> ?').run(username);
  const hash = hashPassword(password);
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (admin) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = ?").run(hash, username);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
  }
})();
NODE
./start.sh
```

### 只清空编程题库

保留用户和初赛题库，删除编程题、测试点、提交记录、题面附件和 checker：

```bash
./start.sh stop
docker compose run --rm --no-deps app node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./backend/db');

db.transaction(() => {
  db.prepare('DELETE FROM submissions').run();
  db.prepare('DELETE FROM oj_problem_tags').run();
  db.prepare('DELETE FROM problem_cases').run();
  db.prepare('DELETE FROM problems').run();
})();

fs.rmSync(path.join(DATA_DIR, 'problems'), { recursive: true, force: true });
fs.mkdirSync(path.join(DATA_DIR, 'problems'), { recursive: true });
NODE
./start.sh
```

重新启动后会恢复内置 `P1001` 示例题。如果你要部署完全空白题库，请在构建镜像前移走 `seed/problems`。

### 只清空初赛题库

保留用户和编程题库，删除初赛试卷、小题、练习记录和模考记录：

```bash
./start.sh stop
docker compose run --rm --no-deps app node - <<'NODE'
const { db } = require('./backend/db');

db.transaction(() => {
  db.prepare('DELETE FROM prelim_attempts').run();
  db.prepare('DELETE FROM prelim_mock_exams').run();
  db.prepare('DELETE FROM oj_prelim_question_tags').run();
  db.prepare('DELETE FROM prelim_questions').run();
  db.prepare('DELETE FROM prelim_groups').run();
  db.prepare('DELETE FROM prelim_papers').run();
})();
NODE
./start.sh
```

重新启动后会恢复内置 CSP-J/S 初赛种子数据。如果你要部署完全空白初赛题库，请在构建镜像前移走 `seed/prelim`。

## 升级

```bash
git pull
./start.sh restart
```

`backend/db.js` 的 `migrate()` 会在启动时补齐新增列。正式升级前仍建议备份数据。

## 排错

### Docker Hub 超时处理

Web 镜像基于 `node:22-bookworm-slim` 构建。若 Docker Hub 拉取基础镜像超时，`start.sh` 会优先尝试配置的镜像加速和国内网络参数。

go-judge 镜像不直接依赖 Docker Hub 的 `criyle/go-judge` 镜像；脚本会先下载 go-judge release 二进制，再通过 `Dockerfile.go-judge` 放入本地镜像。若 release 下载失败，可手动准备 `.runtime/go-judge/go-judge`。

可手动重试：

```bash
./start.sh install
docker compose build --pull app
docker compose build go-judge
```

也可以临时切换网络或设置自有 registry mirror 后再执行 `./start.sh restart`。

端口占用：

```bash
ss -ltnp | grep ':3000'
ss -ltnp | grep ':5050'
```

查看 app 日志：

```bash
docker compose logs -f app
```

查看 judge 日志：

```bash
tail -f logs/judge.log
```

go-judge 健康检查：

```bash
curl http://127.0.0.1:${GO_JUDGE_PORT:-5050}/version
```

重建 go-judge：

```bash
docker compose build --no-cache go-judge
docker compose up -d go-judge
```

## 安全建议

- 公开服务前修改 `JWT_SECRET`、`JUDGE_TOKEN` 和管理员密码。
- 使用 HTTPS。
- 不要开放 go-judge 端口。
- 不要让 Web 容器访问 Docker socket。
- 定期备份数据。
- 根据服务器规格调小 `GO_JUDGE_PROCESS_LIMIT`、`JUDGE_MAX_OUTPUT_BYTES` 和 SPJ 限制。

## 参考资料

- [Docker Compose documentation](https://docs.docker.com/compose/)
- [go-judge](https://github.com/criyle/go-judge)
- [OWASP Transport Layer Protection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html)
