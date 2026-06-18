# LiteOJ 部署手册

本文说明 LiteOJ 的本地、局域网、Docker 和云服务器部署方式。公网同机部署推荐使用项目根目录的 `start.sh`，让 Web 与 judge 保持不同运行边界，并让用户代码进入 Docker 沙箱。

## 1. 推荐服务器配置

### 教学起步

```text
2 核 CPU
4GB 内存
60GB SSD
5～10Mbps 带宽
Ubuntu 22.04 / 24.04
```

### 小型比赛或多班级训练

```text
4 核 CPU
8GB 内存
100GB SSD
10Mbps+ 带宽
Ubuntu 22.04 / 24.04
```

Web 和 SQLite 很轻，主要资源消耗来自 C/C++ 编译和 judge worker。

## 2. 推荐：同机公网一键部署

适用于暂时没有条件拆分 Web 和评测机的服务器：

```bash
cd /opt
git clone <你的仓库地址> LiteOJ
cd LiteOJ
./start.sh
```

`start.sh` 会做这些事：

1. 如果 `.env` 不存在或缺少关键项，自动生成/补齐 `.env`，并写入随机 `JWT_SECRET`、`JUDGE_TOKEN` 和 `ADMIN_PASSWORD`；
2. 非 root 用户会提示输入 sudo 密码，用于安装 Docker、调整 apt 源和启动 Docker daemon；
3. 在 Ubuntu/Debian 上把 apt、Docker apt 仓库、Docker registry、Node.js 下载和 npm registry 尽量切到国内镜像；
4. 检查 Docker Engine 和 Docker Compose plugin，缺失时在 Ubuntu/Debian 上尝试自动安装；
5. 检查宿主机 Node.js，缺失时从国内镜像准备 portable Node.js 22 到 `.runtime/node`；
6. 启动 `docker compose up -d --build app`，只让 Web 服务进入容器；
7. 在宿主机启动 `judge/worker.js`，并强制使用 `JUDGE_SANDBOX=docker`；
8. 每次编译/运行用户代码时创建无网络、限内存、限进程、只读根文件系统的 Docker 沙箱容器。

如果服务器上已经存在旧数据库，脚本不会覆盖已有管理员密码。旧部署仍使用 `admin/admin123` 的，请登录后到个人主页立即修改密码，或清空数据卷后重新初始化。

常用命令：

```bash
./start.sh status
./start.sh logs
./start.sh restart
./start.sh stop
```

访问：

```text
http://服务器IP:3000
```

如果使用 Nginx/HTTPS，建议只反代到本机：

```text
http://127.0.0.1:3000
```

### 脚本安装策略

- Docker 使用官方 apt 仓库安装 Docker Engine、CLI、Buildx 和 Compose plugin；
- Ubuntu/Debian 的 apt 源如果更新失败，会备份原文件并切换到清华镜像；
- Docker registry mirror 默认写入 `docker.1ms.run` 和 `docker.m.daocloud.io`，已有自定义 `/etc/docker/daemon.json` 时不会覆盖；
- 如果当前 shell 尚未继承 docker 组权限，脚本会尝试通过 `sg docker` 启动宿主机 judge；
- Node.js 不强制写入系统目录，优先使用已有 Node/nvm；没有时下载 portable Node.js 到 `.runtime/node`。

### Docker Hub 超时处理

如果构建时看到类似错误：

```text
failed to resolve source metadata for docker.io/library/node:22-bookworm-slim
dial tcp ... registry-1.docker.io:443: i/o timeout
```

通常说明 Docker daemon 没有加载 mirror 配置，或当前网络无法直连 Docker Hub。新版 `start.sh` 会在构建前检查 mirror 是否加载，并预拉取 `node:22-bookworm-slim`；如果 Docker Hub 仍然超时，会尝试直接从 mirror 拉取并重新标记镜像。

手动处理命令如下：

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.m.daocloud.io"
  ]
}
JSON
sudo systemctl restart docker || sudo service docker restart
docker info | grep -A5 "Registry Mirrors"
docker pull node:22-bookworm-slim
```

## 3. 云服务器手动初始化

如果不使用一键脚本，可以手动安装依赖。以 Ubuntu 为例：

```bash
sudo apt update
sudo apt install -y curl git nginx build-essential gcc g++ python3 python3-pip unzip
```

安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

检查：

```bash
node -v
npm -v
g++ --version
python3 --version
```

## 4. 直接部署

```bash
cd /opt
git clone <你的仓库地址> LiteOJ
cd LiteOJ
npm install
cp .env.example .env
npm run init
npm start
```

另开终端：

```bash
npm run judge
```

生产环境建议用 PM2 或 systemd 守护。

直接部署时，如果面向公网提交编程题，至少让 judge 使用 Docker 沙箱：

```bash
JUDGE_SANDBOX=docker JUDGE_SANDBOX_IMAGE=liteoj:latest npm run judge
```

## 5. PM2 守护

```bash
sudo npm install -g pm2
pm2 start backend/server.js --name liteoj-web
JUDGE_SANDBOX=docker JUDGE_SANDBOX_IMAGE=liteoj:latest pm2 start judge/worker.js --name liteoj-judge
pm2 save
pm2 startup
```

查看日志：

```bash
pm2 logs liteoj-web
pm2 logs liteoj-judge
```

## 6. Nginx 反向代理

建议 Web 服务只作为后端应用运行，外层由 Nginx 提供 80/443。

示例：

```nginx
server {
    listen 80;
    server_name example.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS 可使用 certbot 或云厂商证书。

## 7. Docker Compose 手动部署

```bash
cp .env.example .env
# 修改 JWT_SECRET / JUDGE_TOKEN / ADMIN_PASSWORD
docker compose up -d --build app
```

默认 Compose 只建议启动 `app` 服务，适合作为 Web 容器。公网同机部署请配合 `./start.sh`，由脚本在宿主机启动 Docker 沙箱 judge。

容器内 judge 只保留给本地和可信内网教学，必须显式启用 profile：

```bash
docker compose --profile container-judge up -d --build
```

容器内 judge 默认非 root、只读、无特权运行，并且不挂载 `data/` 数据卷，但它仍属于轻量隔离，不建议处理陌生公网用户提交。

停止：

```bash
docker compose down
```

清空数据：

```bash
docker compose down -v
```

## 8. WSL 局域网访问

WSL 内启动：

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

如果局域网其他设备访问不了，需要在 Windows 管理员 PowerShell 设置端口转发：

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=3000 connectaddress=<WSL_IP> connectport=3000
New-NetFirewallRule -DisplayName "LiteOJ 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000
```

WSL IP 查看：

```bash
hostname -I
```

Windows 局域网 IP 查看：

```powershell
ipconfig
```

局域网设备访问：

```text
http://Windows局域网IP:3000
```

## 9. 环境变量

常用配置：

```text
PORT=3000
NODE_ENV=production
DATA_DIR=/app/data
DATABASE_PATH=/app/data/liteoj.db
JWT_SECRET=replace-this-with-a-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-this-admin-password
JUDGE_TOKEN=replace-this-judge-token
BACKEND_URL=http://127.0.0.1:3000
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_MAX_OUTPUT_BYTES=1048576
JUDGE_SANDBOX=docker
JUDGE_SANDBOX_IMAGE=liteoj:latest
JUDGE_SANDBOX_CPUS=1
JUDGE_PROCESS_LIMIT=64
JUDGE_FILE_LIMIT_KB=65536
TESTDATA_ZIP_LIMIT=50
TESTDATA_UNZIPPED_LIMIT=200
LOGIN_RATE_LIMIT=20
REGISTER_RATE_LIMIT=10
COOKIE_SECURE=auto
NPM_REGISTRY=https://registry.npmmirror.com
DOCKER_BUILD_APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
DOCKER_BUILD_APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
DOCKER_BUILD_NETWORK=host
LITEOJ_AUTO_PORT=1
LITEOJ_PORT_SCAN_END=3099
LITEOJ_APT_MIRROR=1
```

正式部署必须修改：

```text
JWT_SECRET
JUDGE_TOKEN
ADMIN_PASSWORD
```

同机宿主机 judge 推荐：

```text
BACKEND_URL=http://127.0.0.1:3000
JUDGE_SANDBOX=docker
```

容器内 judge profile 才使用：

```text
BACKEND_URL=http://app:3000
JUDGE_SANDBOX=host
```

国内网络相关：

```text
NPM_REGISTRY                 # Docker build 内 npm install 使用的 npm registry
DOCKER_BUILD_APT_MIRROR      # Docker build 内 Debian apt 使用的镜像；默认用 http，避免基础镜像安装证书前无法访问 https
DOCKER_BUILD_APT_SECURITY_MIRROR # Docker build 内 Debian security apt 使用的镜像
DOCKER_BUILD_NETWORK=host    # Docker build 使用宿主机网络，适合云服务器和有自定义路由的环境；需要关闭时可设为 default
LITEOJ_AUTO_PORT=1           # start.sh 检测到 PORT 被占用时自动切到下一个可用端口；设为 0 可关闭
LITEOJ_PORT_SCAN_END=3099    # 自动找端口的结束范围
LITEOJ_APT_MIRROR=1          # start.sh 自动将宿主机 Ubuntu/Debian apt 源切到国内镜像；设为 0 可关闭
LITEOJ_DOCKER_APT_REPO       # 可选：指定 Docker CE apt 仓库镜像
LITEOJ_DOCKER_MIRROR=1       # start.sh 自动配置 Docker registry mirror；设为 0 可关闭
```

## 10. 备份与恢复

备份：

```bash
tar -czf liteoj-data-$(date +%F).tar.gz data/
```

恢复：

```bash
tar -xzf liteoj-data-YYYY-MM-DD.tar.gz
```

备份重点是 `data/`，其中包含数据库、测试点和附件。

## 11. 安全建议

- 不要长期使用默认管理员密码。
- 部署后确认响应头中包含 `X-Content-Type-Options: nosniff`，并且不再暴露 `X-Powered-By`。
- 尽量使用 HTTPS。
- 公网部署时限制后台访问或开启更强的服务器安全策略。
- 同机部署时不要把 Docker socket 挂给 Web 容器。
- 推荐使用 `./start.sh` 的“Web 容器 + 宿主机 judge + Docker 沙箱”结构。
- 容器内 `host` judge 只用于本地和可信内网，不要用于陌生公网用户。
- 更高安全等级仍建议把 judge 拆到独立主机/VM，并评估 isolate、nsjail、gVisor 或 Firecracker。
- 不建议让 Web 服务和 judge 共享同一高权限用户；judge 不需要挂载 `data/`，只通过 API 领取测试数据。
- 保留登录/注册限速；如反向代理后面还有 WAF 或限流，可以配合调大 `LOGIN_RATE_LIMIT` 和 `REGISTER_RATE_LIMIT`。
- 测试数据上传同时限制压缩包大小和解压后总大小，避免 zip bomb。
- 定期备份数据。
