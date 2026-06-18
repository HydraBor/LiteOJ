# LiteOJ 架构说明

LiteOJ 是面向教学、班级训练和 CSP-J/S 初赛练习的轻量 OJ。项目目标是：保留教学 OJ 的核心闭环，同时把 CSP-J/S 初赛题库、模考和考点分析作为独立模块提供。

## 1. 总体结构

```text
浏览器 SPA
  ↓
Express API + 静态文件服务
  ↓
SQLite 数据库 + data 文件目录
  ↓
judge worker 独立轮询提交任务
```

推荐同机公网部署时，运行边界是：

```text
Nginx/浏览器
  ↓
liteoj-app Docker 容器
  ↓ 127.0.0.1/API
宿主机 judge worker
  ↓ docker run --network none
一次性编译/运行沙箱容器
```

这种方式不把 Docker socket 暴露给 Web 容器；用户代码只进入一次性沙箱容器，不与 Web 服务或 judge worker 共享进程空间。

主链路：

```text
用户 -> 题库 -> 提交 -> submissions 表 -> judge worker -> 编译/运行/比较输出 -> 回写结果
```

初赛链路：

```text
Markdown 试卷/解析 -> 解析导入 -> 初赛题库 -> 单题练习/模考 -> 数据分析
```

## 2. 模块划分

```text
backend/             Express API、数据库迁移、权限中间件
backend/routes/      按业务拆分的 API 路由
frontend/public/     单页应用，无构建步骤
judge/               独立评测端
seed/                初始化示例题和初赛试卷
data/                运行时数据、SQLite、测试点、附件
docs/                项目文档
scripts/             初始化和测试脚本
```

## 3. 架构取舍

核心设计：

- 主站与评测端分离；
- 题目、提交、评测任务形成主链路；
- 测试数据独立存储；
- 评测端轮询任务并回传结果；
- 题面用一个 Markdown 字段承载完整内容。

主动简化：

- 不做多 Domain；
- 不做插件系统；
- 不做 VJudge；
- 不做博客、讨论、训练计划等复杂模块；
- 不做复杂权限位，仅保留 user/admin；
- 不引入前端构建体系；
- 输入格式、输出格式、样例、提示和数据范围不拆字段，全部写进 Markdown 题面。

## 4. 数据模型

### 4.1 编程题

核心表：

```text
problems
problem_cases
submissions
```

`problems`：

```text
id
title
description
tags_json
difficulty
time_limit
memory_limit
scoring_mode
checker_mode
checker_tolerance
is_public
created_by
created_at
updated_at
```

题号规则：

```text
^[A-Z]+\d+$
```

排序逻辑：先按前缀字典序，再按数字大小。

测试数据目录：

```text
data/problems/P1001/testdata/
```

`problem_cases` 额外保存 `subtask`。子任务为空时按单测试点计分；多个测试点共享同一 `subtask` 时，该组必须全部通过才会获得组内分数。

附件目录：

```text
data/problems/P1001/attachments/
```

### 4.2 初赛题库

核心表：

```text
prelim_papers       初赛试卷元信息，例如年份、组别、轮次、官方总分
prelim_groups       初赛整题；单选题为一题一组，阅读程序/完善程序为一个公共代码块对应多个小题
prelim_questions    小题；保存题干、选项、答案、解析、知识点和分值
prelim_attempts     用户单题练习记录
prelim_mock_exams   初赛模考记录；保存组卷整题 ID、用户答案、得分和官方总分
```

阅读程序和完善程序按“整题 + 小题”存储，公共代码只保存一次。单项选择题内部也是一个整题组，但前端会避免重复渲染整题 stem 与小题 stem。

### 4.3 数据分析

数据分析不额外建表，直接读取 `prelim_questions.tags_json` 和 `score`。

统计输出：

```text
考点出现次数
考点加权分值
各年份考点加权分值对比
```

加权规则写在 `backend/routes/analytics.js` 中。

## 5. 题面渲染

前端提供轻量 Markdown 渲染器，并通过本地路径加载 KaTeX：

```text
/vendor/katex/katex.min.css
/vendor/katex/katex.min.js
```

支持：

```text
$a+b$
\(a+b\)
$$a^2+b^2=c^2$$
\[a^2+b^2=c^2\]
```

题面图片通过附件接口上传，Markdown 中只保存图片 URL，不写入 base64。

## 6. 测试数据 zip 上传

接口：

```text
POST /api/problems/:id/cases/zip
```

服务端会：

1. 接收 zip；
2. 忽略目录、`__MACOSX` 和非数据文件；
3. 识别同名 `.in` 与 `.out/.ans`；
4. 自然排序；
5. 目录名写入 `subtask` 字段；
6. 写入 `data/problems/<id>/testdata/`；
7. 同步写入 `problem_cases`；
8. 根据参数覆盖旧数据或追加数据；
9. 可自动平均分配 100 分。

## 7. Judge 设计

当前 judge 支持两种模式：

```text
host: timeout + ulimit + 独立工作目录
docker: 每次编译/运行进入无网络、限内存、限进程、只读根文件系统的 Docker 容器
```

`host` 适合本地、内网和小规模课程训练。公网同机部署时，推荐通过 `liteoj.sh` 让 Web 跑在 `app` 容器中、judge worker 跑在宿主机上，并启用 `JUDGE_SANDBOX=docker`。更高安全要求时仍建议把 judge worker 拆到独立主机或隔离 VM，或替换为 isolate、nsjail、gVisor、Firecracker 等更强沙箱。

`docker-compose.yml` 中的 `judge` 服务放在 `container-judge` profile 下，仅作为本地或可信内网的简化部署方式，不作为公网陌生提交的推荐路径。

评测结算支持：

```text
OI 按点累计
ACM 全过得分
子任务整组得分
标准比较 / 忽略空白 / 大小写不敏感 / 浮点误差
```

## 8. 前端路由

前端为 SPA，所有页面由 `frontend/public/app.js` 根据 `location.pathname` 渲染。

核心原则：

- 使用 `data-route`；
- 不使用 `javascript:` 链接；
- 不在 HTML 属性里拼接未转义字符串；
- 字符串题号统一通过 `encodeURIComponent` 处理；
- 表格操作按钮放在内部 flex 容器中，`td` 保持 table-cell。

## 9. 初始化种子

初始化会导入：

```text
seed/problems/P1001
seed/prelim/2019-CSP-J1.md
...
seed/prelim/2025-CSP-J1.md
```

A+B 示例题保留必要公式，标签只保留“模拟”。

## 10. 终版设计取舍

数据分析曾尝试引入地区分数线和联网同步，但该逻辑与初赛题库考点统计耦合过重，终版已移除。当前数据分析只基于已录入试卷和考点权重，结果更稳定、更适合教学备课。
