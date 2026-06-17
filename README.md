# LiteOJ

LiteOJ 是一个轻量化在线评测系统，面向信奥训练和 CSP-J/S 初赛练习场景。项目保留最常用的 OJ 功能链路，额外提供 CSP-J/S 初赛题库、初赛模考和考点数据分析。

## 功能总览

### 编程题库

- 用户注册、登录、退出；管理员权限。
- 编程题题库、题目详情、代码提交、提交记录。
- 题面使用单个 Markdown 字段承载完整内容，支持 KaTeX、代码高亮和图片附件。
- 后台支持新增、编辑、隐藏/公开、复制、删除题目。
- 支持手动添加测试点，也支持 zip 批量上传 `.in + .out/.ans` 测试数据。
- 支持 C11、C++11、C++14、C++17、Python 3。
- C/C++ 默认开启 O2，提交时可关闭。
- 独立 judge worker 负责编译、运行、比较输出并回写 AC/WA/TLE/RE/CE/PA。

### CSP-J/S 初赛题库

- 初赛题库独立于编程题库。
- 支持单项选择题、判断题、阅读程序、完善程序。
- 单项选择题按单题展示；阅读程序和完善程序按“整题 + 小题”展示，公共代码块只出现一次。
- 支持按年份、组别、题型、知识点和关键词筛选。
- 点击选项后即时判题，并显示答案、解析和知识点 tag。
- 初始化内置 2019～2025 CSP-J1 试卷和解析 Markdown。

### 初赛模考

- 可从初赛题库自动组卷。
- 支持开始练习、提交判分、查看报告。
- 模考总分以试卷官方总分为准，避免 Markdown 小题分值累加误差影响显示。

### 数据分析

- 位于导航栏“初赛模考”和“后台管理”之间。
- 筛选条件只保留年份和组别，默认不预选。
- 第一张图统计考点出现次数，按次数降序排列。
- 第二张图统计考点加权分值，用中空饼图展示。
- 第三块表格把各年份的考点加权分值并列展示，方便横向比较。
- 加权分值规则：每个小题若只有一个考点，该考点获得该小题全部分值；若有两个及以上考点，只取权重最高的两个，并按二者权重比例分配该小题分值；若权重缺失或均为 0，则这两个考点平均分配。

## 快速开始

### 本地运行

需要安装：

- Node.js 22
- gcc / g++
- python3

```bash
npm install
npm run init
npm start
```

另开一个终端启动评测端：

```bash
npm run judge
```

访问：

```text
http://localhost:3000
```

默认管理员：

```text
admin / admin123
```

### Docker Compose 运行

```bash
cp .env.example .env
# 修改 JWT_SECRET 和 JUDGE_TOKEN
docker compose up -d --build
```

访问：

```text
http://localhost:3000
```

查看日志：

```bash
docker compose logs -f app
docker compose logs -f judge
```

停止：

```bash
docker compose down
```

清空数据卷：

```bash
docker compose down -v
```

## 常用命令

```bash
npm run init        # 初始化数据库、管理员、示例题和初赛种子卷
npm start           # 启动 Web 服务
npm run judge       # 启动评测端
npm run check       # JS 语法检查
npm run smoke       # 静态烟雾测试
npm run real-smoke  # 启动临时服务并测试真实 API 链路
npm test            # check + smoke + real-smoke
```

## 项目结构

```text
LiteOJ/
├── backend/
│   ├── server.js              # Express 主服务和 API 挂载
│   ├── db.js                  # SQLite 表结构、迁移和数据转换
│   ├── auth.js                # 登录态、Cookie、安全配置和权限中间件
│   ├── problem-utils.js       # 题号校验、题号排序、难度处理
│   ├── prelim-utils.js        # CSP 初赛 Markdown 解析
│   └── routes/
│       ├── auth.js            # 登录、注册、退出、当前用户
│       ├── problems.js        # 编程题、测试点、附件、提交入口
│       ├── submissions.js     # 提交记录和提交详情
│       ├── judge.js           # judge worker 领取任务和回传结果
│       ├── prelim.js          # 初赛题库、模考、Markdown 导入
│       ├── analytics.js       # 初赛考点统计分析
│       └── admin.js           # 后台统计和用户管理
├── frontend/public/
│   ├── index.html             # 单页应用入口
│   ├── app.js                 # 前端路由和页面渲染
│   ├── style.css              # UI 样式
│   ├── logo.svg               # 导航栏 Logo
│   └── logo-mark.svg          # favicon / 登录页图标
├── judge/
│   ├── worker.js              # 评测端轮询任务
│   ├── runner.js              # 编译、运行、逐点比较
│   ├── languages.js           # 语言配置
│   └── checker.js             # 输出比较
├── seed/
│   ├── problems/              # 初始化编程题
│   └── prelim/                # 2019～2025 CSP-J1 初赛 Markdown 和解析
├── data/                      # SQLite 数据库、测试点和附件目录
├── docs/                      # 开发文档和使用手册
├── scripts/                   # 初始化和测试脚本
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 文档

- [开发文档](docs/DEVELOPMENT.md)
- [使用手册](docs/USER_MANUAL.md)
- [部署手册](docs/DEPLOYMENT.md)
- [架构说明](docs/ARCHITECTURE.md)
- [终版检查记录](docs/FINAL_REVIEW.md)

## 安全说明

当前 judge 采用 `timeout + ulimit + 独立临时目录` 的轻量教学级限制，适合本地、内网和小规模教学场景。若要面向公网长期开放，建议后续接入 isolate、nsjail、gVisor、Firecracker 或独立容器沙箱。

正式部署建议：

- 使用 HTTPS。
- 修改 `.env` 中的 `JWT_SECRET` 和 `JUDGE_TOKEN`。
- Web 服务放在 Nginx 反向代理后面。
- 定期备份 `data/` 目录。
- 不要以 root 权限长期运行 judge。

## 版本状态

当前版本：`1.2.3`。

本版已清理上一阶段数据分析试验中的地区/分数线同步逻辑，数据分析模块回归为稳定、简洁的考点统计工具；同时补充安全响应头、bcrypt 密码校验封装和个人主页改密功能。
