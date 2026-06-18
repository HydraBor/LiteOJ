# LiteOJ 部署手册

本文说明 LiteOJ 的本地、局域网、Docker 和云服务器部署方式。

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

## 2. 云服务器初始化

以 Ubuntu 为例：

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

## 3. 直接部署

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

## 4. PM2 守护

```bash
sudo npm install -g pm2
pm2 start backend/server.js --name liteoj-web
pm2 start judge/worker.js --name liteoj-judge
pm2 save
pm2 startup
```

查看日志：

```bash
pm2 logs liteoj-web
pm2 logs liteoj-judge
```

## 5. Nginx 反向代理

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

## 6. 一键 Docker 部署

推荐在云服务器上使用：

```bash
cd LiteOJ
chmod +x ./liteoj.sh ./litoj.sh
./liteoj.sh start
```

`liteoj.sh` 会：

1. 自动创建 `.env` 并生成随机 `JWT_SECRET` / `JUDGE_TOKEN`；
2. 检查 Docker Engine 和 Docker Compose plugin；
3. 缺失时在 Ubuntu/Debian 上自动安装 Docker；
4. 写入 Docker registry mirror；
5. 重启 Docker daemon，让 mirror 配置立即生效；
6. 构建前预拉取 `node:22-bookworm-slim`，如果 Docker Hub 超时会尝试国内 mirror 地址。

如果看到下面这种错误：

```text
failed to resolve source metadata for docker.io/library/node:22-bookworm-slim
dial tcp ... registry-1.docker.io:443: i/o timeout
```

说明 Docker daemon 没有加载 mirror 配置，或当前网络无法直连 Docker Hub。请使用新版 `liteoj.sh`，或手动执行：

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

## 7. Docker Compose 手动部署

```bash
cp .env.example .env
# 修改 JWT_SECRET / JUDGE_TOKEN
docker compose up -d --build
```

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
JUDGE_TOKEN=replace-this-judge-token
BACKEND_URL=http://app:3000
JUDGE_POLL_INTERVAL_MS=2000
COOKIE_SECURE=auto
```

正式部署必须修改：

```text
JWT_SECRET
JUDGE_TOKEN
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
- judge 当前为教学级隔离，公开给陌生用户使用前建议替换为更强沙箱。
- 定期备份数据。
