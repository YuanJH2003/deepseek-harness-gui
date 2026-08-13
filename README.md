# dsh-gui — DeepSeek Harness 独立桌面窗口

本目录 **`D:\learn\vla\dsh-gui`** 是从 `D:\tool\deepseek-harness` 完整复制的独立工作副本（原仓库**未做任何修改**），并在此基础上加入一个“桌面 GUI 启动网关”：双击即可打开 Harness 的应用窗口，**启动时不经过 npm、不依赖在浏览器里手动输入地址**。

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
| `dsh-gui` / 双击 `dsh-gui.cmd` | 启动服务并打开桌面窗口 |
| `dsh-gui --port 9527` | 指定端口（默认由系统分配空闲端口） |
| `dsh-gui --no-open` | 只启动服务，不弹窗口（可自行用浏览器访问打印出的 URL） |
| `dsh-gui --stop` / 双击 `dsh-gui-stop.cmd` | 停止上次残留的服务进程 |
| `dsh-gui -- --trusted-host x` | `--` 之后的参数原样透传给 web profile |

以上也注册为 `pnpm gui` / `pnpm gui:stop`（见副本根 `package.json`）。

## 工作原理

- 桌面图标「DeepSeek Harness GUI」（`.lnk` → `wscript dsh-gui.vbs`）以**隐藏控制台**方式运行同一个网关：`dsh-gui.vbs` 先检查 node 是否存在，再静默启动；`dsh-gui.cmd --make-shortcut` 负责生成该图标。
- `dsh-gui.mjs` 是一个 Node 脚本（唯一的运行时依赖是已安装的 Node.js，**启动过程不调用 npm**）。它以 `node --import tsx/esm apps/cli/src/bin.ts --profile web --port <port>` 派生启动 web profile 服务。
- 监听服务输出中的就绪行 `dsh web: http://127.0.0.1:PORT`，解析出实际地址。
- 用 Edge（找不到时回退 Chrome）的 `--app=<url>` + **独立 `--user-data-dir`** 打开一个无标签页、无地址栏的应用窗口，并禁用扩展与账户同步（`--disable-extensions --disable-sync` 等），避免主浏览器的扩展（如脚本猫）被同步进来弹引导页；这个独立 Edge 实例的生命周期等同于窗口的生命周期，**窗口关闭 → 网关收到退出 → 停止服务 → 网关退出**。调试时可用环境变量 `DSH_GUI_DEBUG_PORT=<port>` 为该窗口开启远程调试端口。
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
- **应用窗口关掉后服务仍在**：用 `dsh-gui-stop.cmd` 清理。
- **界面空白 / 样式不对**：确认 `apps/web/dist/index.html` 存在（见“一次性准备”第 2 条）。

## 与主仓库的关系

- `D:\tool\deepseek-harness`：原仓库，只读参照，**未被修改**。
- `D:\learn\vla\dsh-gui`：工作副本 + 本 GUI 网关。所有产物（GUI 脚本、日志、PID）都在本目录。
- 需要原样恢复主仓库功能时忽略本目录即可；本目录不影响原仓库的任何状态。