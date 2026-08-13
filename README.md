# dsh-gui — DeepSeek Harness 独立桌面窗口

本目录是从 **DeepSeek Harness 官方仓库完整复制的独立工作副本**（原仓库代码**未做任何修改**），并在此基础上加入一个“桌面 GUI 启动网关”：双击即可打开 Harness 的应用窗口，**启动时不经过 npm、不依赖在浏览器里手动输入地址**。

它与 `dsh web` 启动的是完全相同的服务（同一个 `web` profile、同一个 `$DSH_HOME` 下的会话与存储），区别只在于：不需要敲命令，界面以独立应用窗口呈现，关窗即停服。

原仓库自带的说明文档保留在 [`README.harness.md`](README.harness.md)（及 [`README.zh.md`](README.zh.md)），未作改动。

## 快速开始

**双击桌面图标「DeepSeek Harness GUI」**（推荐，无控制台窗口；图标为 DeepSeek 官方鲸鱼 Logo，取自仓库自带 favicon）；服务器会在后台静默启动，等 30–90 秒后弹出应用窗口，**关闭窗口即停止全部服务**。

如果没有该图标（比如换了电脑），先运行一次 `dsh-gui.cmd --make-shortcut` 生成；也可以：

- 双击 **`dsh-gui.cmd`** —— 功能完全相同，但会显示一个控制台窗口（便于看日志）；
- 或命令行运行 `node dsh-gui.mjs`。

## 用法

| 命令 | 作用 |
| --- | --- |
| `dsh-gui` / 双击 `dsh-gui.cmd` | 已有服务在运行则**接管连接**（不再开第二个服务）；否则自起服务并打开桌面窗口 |
| `dsh-gui --port 9527` | 指定端口（明确指定端口 = 显式要求自起一个服务） |
| `dsh-gui --parallel` | 即使检测到已有服务，也强制再起一个（不推荐） |
| `dsh-gui --no-open` | 只启动服务，不弹窗口（可自行用浏览器访问打印出的 URL） |
| `dsh-gui --stop` / 双击 `dsh-gui-stop.cmd` | 停止上次残留的服务进程 |
| `dsh-gui -- --trusted-host x` | `--` 之后的参数原样透传给 web profile |

以上也注册为 `pnpm gui` / `pnpm gui:stop`（见副本根 `package.json`）。

## 工作原理

- 桌面图标「DeepSeek Harness GUI」（`.lnk` → `wscript dsh-gui.vbs`）以**隐藏控制台**方式运行同一个网关：`dsh-gui.vbs` 先检查 node 是否存在，再静默启动；`dsh-gui.cmd --make-shortcut` 负责生成该图标。
- `dsh-gui.mjs` 是一个 Node 脚本（唯一的运行时依赖是已安装的 Node.js，**启动过程不调用 npm**）。它以 `node --import tsx/esm apps/cli/src/bin.ts --profile web --port <port>` 派生启动 web profile 服务。
- **单写入者保护**：启动前探测本机是否已有 Harness 服务在运行（默认探测 127.0.0.1:3080，只读、不写任何数据）；若存在，本窗口改为**直接接管连接**（用已有服务的地址开窗，关窗不停其服务），而不是再派生一个写进程——两个进程同时写同一个活跃会话会导致日志序号错位（`seq gap in committed region`）。`--parallel` 或显式 `--port` 可强制自起服务。
- 监听服务输出中的就绪行 `dsh web: http://127.0.0.1:PORT`，解析出实际地址。
- 用 Edge（找不到时回退 Chrome）的 `--app=<url>` + **独立 `--user-data-dir`** 打开一个无标签页、无地址栏的应用窗口，并禁用扩展与账户同步（`--disable-extensions --disable-sync` 等），避免主浏览器的扩展（如脚本猫）被同步进来弹引导页；这个独立 Edge 实例的生命周期等同于窗口的生命周期，**窗口关闭 → 网关收到退出 → 停止服务 → 网关退出**。调试时可用环境变量 `DSH_GUI_DEBUG_PORT=<port>` 为该窗口开启远程调试端口。
- **任务栏图标**：应用窗口以 Edge 启动但带专属应用身份（`--app-user-model-id=DeepSeekHarnessGUI`），在任务栏中作为**独立应用**显示（不会与浏览器 Edge 归为同一组）；同时网关会运行 `dsh-gui-taskbar-icon.ps1` 直接把窗口图标替换为**深色鲸鱼**（跨进程改窗口类图标，Edge 对 `--app` 窗口不采用快捷方式图标关联，所以用直接替换；失败时静默降级为 Edge 图标）。`dsh-gui.cmd --make-shortcut` 会为快捷方式打上同样的身份。普通 Edge 浏览窗口不受影响。若图标缓存未刷新，桌面图标可重启资源管理器或运行 `ie4uinit.exe -show` 恢复。
- 服务日志追加写入 `dsh-gui.log`，服务进程 PID 写入 `dsh-gui.pid`（供 `--stop` 使用）。
- 安全：web profile 仅绑定 `127.0.0.1`（与 `dsh` 的既有限制一致，`--host 0.0.0.0` 会被拒绝）。

## 一次性准备（本副本已完成）

1. `pnpm install` —— 安装全部 workspace 依赖（之后运行时不再需要 npm）。
2. 前端构建产物 `apps/web/dist` 已从原仓库复制过来；如需重新构建：`pnpm build:web`。
3. 无需任何新配置：模型路由与密钥沿用本机 `$DSH_HOME`（`settings.yaml` + `.credentials.yaml`），会话与主仓库的 web GUI 完全互通。

## 常见问题

- **双击图标后一两分钟没反应**：首次启动服务需要 30–90 秒（加载全部插件）；日志见 `dsh-gui.log`。
- **窗口里弹出脚本猫（ScriptCat）的引导页（docs.scriptcat.org）**：已修复。根因是 Edge 会把你在主浏览器里安装的扩展（含脚本猫）**同步进应用窗口的临时 profile**，脚本猫检测到该 profile 未开启“允许用户脚本”后每次启动都弹引导页。应用窗口现已加 `--disable-extensions --disable-sync` 等开关杜绝扩展与同步。窗口里剩余的 chrome-extension 页面是 Edge 内置组件（反馈、WebRTC 等），不会弹页面，与 Harness 无关。
- **双击后无窗口、控制台提示 node not found**：安装 Node.js 22 或更新版本后重试。
- **没有弹出窗口，但 `dsh-gui.log` 打印了 `ready at …`**：本机既没有 Edge 也没有 Chrome，网关已改用默认浏览器打开该 URL。
- **提示端口被占用**：换成 `dsh-gui --port <其它端口>`。
- **历史加载失败 / 模型操作失败：corrupt session log: seq gap in committed region**：这是**同一个会话同时被两个 Harness 进程写入**导致的日志序号错位（例如桌面窗口与 `dsh web`（默认 3080 端口）同时打开同一个会话，两个进程各自维护序号向同一文件追加）。预防：**不要同时在两个窗口打开同一个会话**；网关现在会检测已有服务并改为“接管连接”，不再默认开第二个服务。若已损坏且无法打开：备份 `$DSH_HOME/sessions/<项目>/<会话id>/session.jsonl.zstd` 后联系维护者修复（或等该会话所在的服务停止、不再写入后，再做一次全量对齐修复）。
- **应用窗口关掉后服务仍在**：用 `dsh-gui-stop.cmd` 清理。
- **界面空白 / 样式不对**：确认 `apps/web/dist/index.html` 存在（见“一次性准备”第 2 条）。

## 与主仓库的关系

- 上游：DeepSeek Harness 官方仓库（MIT 协议），只读参照，**未被修改**。
- 本仓库：独立工作副本 + 本 GUI 网关。所有产物（GUI 脚本、日志、PID）都在本目录内，不涉及任何上游外部路径。
- 需要原样恢复主仓库功能时忽略本目录即可；本目录不影响上游仓库的任何状态。