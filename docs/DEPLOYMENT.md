# LiteOJ 部署手册

更新时间：2026-06-19

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
ADMIN_USERNAME=Algor
ADMIN_PASSWORD=Wuchuanmin_2003
COOKIE_SECURE=auto
```

评测变量：

```dotenv
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_MAX_OUTPUT_BYTES=1048576
GO_JUDGE_URL=http://127.0.0.1:5050
GO_JUDGE_PROCESS_LIMIT=64
SPJ_TIMEOUT_MS=3000
SPJ_MEMORY_LIMIT_MB=256
```

上传限制：

```dotenv
TESTDATA_ZIP_LIMIT=50
TESTDATA_UNZIPPED_LIMIT=200
CHECKER_SOURCE_LIMIT=1
```

单位说明：

- `TESTDATA_ZIP_LIMIT`：MB，zip 原始文件大小。
- `TESTDATA_UNZIPPED_LIMIT`：MB，zip 解压后总大小。
- `CHECKER_SOURCE_LIMIT`：MB，checker.cpp 源码大小。
- `SPJ_TIMEOUT_MS`：毫秒，checker 单次运行时间。
- `SPJ_MEMORY_LIMIT_MB`：MB，checker 单次运行内存。

## 管理员账号

新数据库会使用 `.env` 中的：

```dotenv
ADMIN_USERNAME=Algor
ADMIN_PASSWORD=Wuchuanmin_2003
```

已有数据库不会在每次启动时重置密码。忘记管理员密码时执行：

```bash
docker compose exec app npm run reset-admin -- Algor Wuchuanmin_2003
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

不要反代或暴露 `GO_JUDGE_PORT`。

## 备份与恢复

数据位于 Docker volume `liteoj_liteoj-data`。建议定期备份：

```bash
docker run --rm \
  -v liteoj_liteoj-data:/data:ro \
  -v "$PWD/backups":/backup \
  busybox sh -c 'tar czf /backup/liteoj-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
```

恢复前请停止服务：

```bash
./start.sh stop
```

再解压备份到 volume。

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
