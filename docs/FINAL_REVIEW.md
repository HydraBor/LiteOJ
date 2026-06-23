# LiteOJ 收尾检查记录

更新时间：2026-06-23

## 检查范围

本次收尾覆盖：

- 编程题库；
- 题面编辑；
- 测试数据管理；
- Special Judge；
- go-judge 评测链路；
- 账号、个人改密和后台用户管理；
- 提交记录；
- CSP-J/S 初赛题库；
- 初赛模考；
- 数据分析；
- 部署脚本和环境变量；
- README 与 docs 文档。

## 资料对照

本次按以下资料校准实现：

- go-judge：使用 `/run`、`copyIn`、`copyOut`、`copyOutCached` 的受限执行模型。
- testlib：checker 使用 `registerTestlibCmd(argc, argv)`，约定 `inf`、`ouf`、`ans`。
- CMS Score types：子任务/group 以整组结果决定分值。
- OWASP Password Storage：密码使用 bcrypt，不保存明文。
- Docker Compose 文档：服务编排、profile 和健康检查。
- Express 文档：路由和静态资源服务。

## 当前实现结论

### 编程题

- 新增题目默认隐藏。
- 新增流程为先编辑题面，再进入测试数据管理。
- 题目详情页右上角只显示“编辑”。
- 题面 Markdown 支持 KaTeX、代码块、表格对齐、`^` 纵向合并、`:::align{center}` 和 `::cute-table{tuack}`。
- 题面图片和附件通过后端接口上传，预览不会使用 base64 内嵌。
- 附件最终文件名保留安全化后的原始 basename，下载时使用标准 `Content-Disposition`。
- Special Judge 在题面编辑中启用，在测试数据管理页上传 `checker.cpp`。

### 测试数据

- zip 支持 `.in/.out` 和 `.in/.ans`。
- zip 中 `checker.cpp` 会自动启用 Special Judge。
- 测试点管理不加载输入输出正文。
- 普通测试点按点计分。
- 子任务按整组计分，组内全部通过才得分。
- 支持多选测试点整体拖拽。
- 支持测试点单独时空限制。

### 评测

- Web 不执行用户代码。
- 用户程序和 checker 都由 go-judge 编译/运行。
- C++ 默认 O2，非 C++ 不显示 O2。
- TLE/MLE/OLE/RE/CE/System Error 都在 runner 中归一化。
- SPJ checker 编译失败或运行系统错误会返回 System Error。

### 初赛题库和模考

- 初赛题库按题组展示阅读程序和完善程序。
- 小题即时判题。
- 模考可从试卷生成，提交后显示报告。
- 统一标签系统使用 slug 作为唯一标识，中文名作为唯一展示名；导入和编程题选标签只接受固定表中的 slug。
- 数据分析使用已录入题库计算 canonical 考点出现次数和加权分值。

### 账号和安全

- 登录/注册有基础限速。
- 密码使用 bcrypt。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`，HTTPS 下自动 `Secure`。
- API 禁用缓存。
- judge 内部接口使用 `JUDGE_TOKEN`。

### 部署

- 统一入口为 `./start.sh`。
- `start.sh` 支持安装、启动、停止、重启、日志和状态。
- app 与 go-judge 使用 Docker Compose。
- 宿主机 judge worker 调用 go-judge。
- 国内镜像源、portable Node.js 和 go-judge 下载逻辑已保留。
- SPJ 环境变量已同步到 `.env.example`、`scripts/deploy/env.sh`、`scripts/deploy/services.sh` 和 `docker-compose.yml`。
- 部署文档补充了全量备份、恢复、清空 Docker 数据、只清空用户数据、只清空编程题库和只清空初赛题库的命令。

## 本次清理

- 删除 README 中不存在的入口脚本说明。
- 删除题面编辑里新增测试点的遗留前端函数。
- 删除文档中输出比较、浮点误差等已不作为 UI 功能暴露的说明。
- 重写 README、架构文档、部署文档、开发文档、使用手册和收尾检查。
- 补全 API 清单和环境变量说明。
- 修正题面自定义 Markdown 指令、拆行图片链接预览和附件重命名逻辑。

## 验证清单

建议每次收尾执行：

```bash
npm run check
npm run smoke
npm run real-smoke
docker compose config
git diff --check
```

本次额外验证：

- `npm test` 覆盖语法检查、静态 smoke 和真实 API smoke；
- `git diff --check` 无空白错误；
- `docker compose config` 可正常解析；
- 前端 Markdown 渲染函数可正确输出 `:::align{center}`、`::cute-table{tuack}`、表格 `rowspan` 和拆行图片链接。

## 已知边界

- SQLite 适合单机教学场景，不适合高并发公网大规模比赛。
- 内存限速器在多进程部署下不共享状态。
- go-judge 容器需要特权模式，生产环境建议放在隔离主机或更强隔离边界内。
- `checker.cpp` 由题目管理员上传，系统会限制编译/运行资源，但 checker 本身仍应审查。
- CSP 初赛种子数据用于训练和解析展示，正式考试数据需由管理员自行核对。

## 后续建议

- 为 API 增加 OpenAPI 描述。
- 为测试数据管理页增加批量删除和批量时空限制操作。
- 为 judge worker 增加并发数配置。
- 为提交记录增加筛选和分页。
- 为管理员操作增加审计日志。
