# dsh-gui — DeepSeek Harness 独立桌面窗口

本目录是从 **DeepSeek Harness 官方仓库完整复制的独立工作副本**（原仓库代码**未做任何修改**），并在此基础上加入一个“桌面 GUI 启动网关”：双击即可打开 Harness 的应用窗口，**启动时不经过 npm、不依赖在浏览器里手动输入地址**。

它与 `dsh web` 启动的是完全相同的服务（同一个 `web` profile、同一个 `$DSH_HOME` 下的会话与存储），区别只在于：不需要敲命令，界面以独立应用窗口呈现，关窗即停服。

原仓库自带的说明文档保留在 [`README.harness.md`](README.harness.md)（及 [`README.zh.md`](README.zh.md)），未作改动。

## 快速开始

**双击桌面图标「DeepSeek Harness GUI」**（推荐，无控制台窗口；图标为 DeepSeek 官方鲸鱼 Logo，取自仓库自带 favicon）；服务器直接运行**预编译产物**（`apps/cli/lib/bin.js`），冷启动约 1~2 秒就绪（首次可能稍久），随后立即弹出应用窗口，**关闭窗口即停止全部服务**。

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
- `dsh-gui.mjs` 是一个 Node 脚本（唯一的运行时依赖是已安装的 Node.js，**启动过程不调用 npm**）。它优先以 `node apps/cli/lib/bin.js --profile web --port <port>` 派生启动 web profile **编译产物**（比 `tsx/esm` 跑源码冷启动快约 14 倍：1~2 秒 vs 22 秒）；若副本没有编译产物（如刚 clone 未构建），自动回退到 `node --import tsx/esm apps/cli/src/bin.ts`。
- **单写入者保护**：`web` profile 启动时会在 `$DSH_HOME` 下建立单写入者锁 `dsh-web.lock`（记录持有进程 pid、端口与就绪 URL）。第二个 `dsh web`（或 `pnpm dsh web`）在锁持有者还存活时启动，会被**直接拒绝**并提示去打开已有服务，而不是再派生一个写进程——两个进程同时写同一个活跃会话正是日志序号错位（`seq gap in committed region`）的根源。持有者异常退出（崩溃/被强杀）后锁自动视为失效，下次启动自动接管；关窗/停服时锁随服务停止而释放。`DSH_GUI_FORCE_WEB=1` 可显式绕过（对应下方 `--parallel` / 显式 `--port`）。
- **接管既有服务**：启动前先探测默认端口 3080 与锁文件。若已有 Harness 服务在运行（无论是否由本网关启动：锁文件、或 3080 端口应答），本窗口改为**直接接管连接**（用已有服务的地址开窗，关窗不停其服务）；锁文件中记录了存活持有者但端口无法连通时，网关拒绝再开第二个并给出提示。
- 监听服务输出中的就绪行 `dsh web: http://127.0.0.1:PORT`，解析出实际地址。
- 用 Edge（找不到时回退 Chrome）的 `--app=<url>` + **独立 `--user-data-dir`** 打开一个无标签页、无地址栏的应用窗口，并禁用扩展与账户同步（`--disable-extensions --disable-sync` 等），避免主浏览器的扩展（如脚本猫）被同步进来弹引导页；这个独立 Edge 实例的生命周期等同于窗口的生命周期，**窗口关闭 → 网关收到退出 → 停止服务 → 网关退出**。调试时可用环境变量 `DSH_GUI_DEBUG_PORT=<port>` 为该窗口开启远程调试端口。
- **任务栏图标**：应用窗口以 Edge 启动但带专属应用身份（`--app-user-model-id=DeepSeekHarnessGUI`），在任务栏中作为**独立应用**显示（不会与浏览器 Edge 归为同一组）；同时网关会运行 `dsh-gui-taskbar-icon.ps1` 直接把窗口图标替换为**深色鲸鱼**（跨进程改窗口类图标，Edge 对 `--app` 窗口不采用快捷方式图标关联，所以用直接替换；失败时静默降级为 Edge 图标）。`dsh-gui.cmd --make-shortcut` 会为快捷方式打上同样的身份。普通 Edge 浏览窗口不受影响。若图标缓存未刷新，桌面图标可重启资源管理器或运行 `ie4uinit.exe -show` 恢复。
- 服务日志追加写入 `dsh-gui.log`，服务进程 PID 写入 `dsh-gui.pid`（供 `--stop` 使用）。
- 安全：web profile 仅绑定 `127.0.0.1`（与 `dsh` 的既有限制一致，`--host 0.0.0.0` 会被拒绝）。

## 一次性准备（本副本已完成）

1. `pnpm install` —— 安装全部 workspace 依赖（之后运行时不再需要 npm）。
2. 前端构建产物 `apps/web/dist` 已从原仓库复制过来；如需重新构建：`pnpm build:web`。
3. 无需任何新配置：模型路由与密钥沿用本机 `$DSH_HOME`（`settings.yaml` + `.credentials.yaml`），会话与主仓库的 web GUI 完全互通。
4. CLI 编译产物 `apps/cli/lib/*` 已随仓库提交（本网关的启动路径）。**改过 `apps/cli/src` 里的逻辑（如 `web-lock.ts`）后，必须重跑 `pnpm build:lib:host` 重建，否则桌面版仍跑旧产物**。

## 常见问题

- **双击图标后几秒没反应**：新版走编译产物，通常 1~3 秒即就绪；若刚改过 `apps/cli/src` 而未重建、且恰好没有编译产物，会退回慢速 tsx 路径（较久）。日志见 `dsh-gui.log`。
- **窗口里弹出脚本猫（ScriptCat）的引导页（docs.scriptcat.org）**：已修复。根因是 Edge 会把你在主浏览器里安装的扩展（含脚本猫）**同步进应用窗口的临时 profile**，脚本猫检测到该 profile 未开启“允许用户脚本”后每次启动都弹引导页。应用窗口现已加 `--disable-extensions --disable-sync` 等开关杜绝扩展与同步。窗口里剩余的 chrome-extension 页面是 Edge 内置组件（反馈、WebRTC 等），不会弹页面，与 Harness 无关。
- **双击后无窗口、控制台提示 node not found**：安装 Node.js 22 或更新版本后重试。
- **没有弹出窗口，但 `dsh-gui.log` 打印了 `ready at …`**：本机既没有 Edge 也没有 Chrome，网关已改用默认浏览器打开该 URL。
- **提示端口被占用**：换成 `dsh-gui --port <其它端口>`。
- **历史加载失败 / 模型操作失败：corrupt session log: seq gap in committed region**：这是**同一个会话同时被两个 Harness 进程写入**导致的日志序号错位（例如桌面窗口与 `dsh web`（默认 3080 端口）同时打开同一个会话，两个进程各自维护序号向同一文件追加）。预防：**不要同时在两个窗口打开同一个会话**；网关会检测已有服务并改为“接管连接”，不再默认开第二个服务；另外 `web` 启动自带**单写入者锁**（`$DSH_HOME/dsh-web.lock`），锁持有者存活时第二个服务端会被直接拒绝。若已损坏且无法打开：备份 `$DSH_HOME/sessions/<项目>/<会话id>/session.jsonl.zstd` 后联系维护者修复（或等该会话所在的服务停止、不再写入后，再做一次全量对齐修复）。
- **应用窗口关掉后服务仍在**：网关现在会等待服务进程真正退出（超时则强杀兜底）再释放锁并退出，正常情况下不会残留；万一仍残留（包括 PID 文件丢失、只剩锁记录的情况），用 `dsh-gui-stop.cmd` 清理（按 `dsh-gui.pid` 或锁文件定位服务进程）。
- **点了图标第一次没反应，隔几秒再点才行**：有两个叠加原因，均已修复。**① 锁路径不一致（真正根因）**：早期版本网关按 `C:\Users\<用户>\dsh-web.lock` 读锁，而 CLI 在 `C:\Users\<用户>\.dsh\dsh-web.lock` 写锁——网关永远看不到活着的服务端，派生的子进程就会被 CLI 的锁守卫拒绝（控制台隐藏，看起来“没反应”）；现网关已改用与 CLI 完全一致的路径（`$DSH_HOME`，缺省 `~/.dsh`）。**② 收尾窗口期**：刚关窗的服务仍在收尾（最多几秒才放锁），此窗口内的点击会被锁拦下；新版网关发现“有持锁者但暂时不可达”时会**原地等待最多 8 秒**，旧服务一退出就自动接管启动。若 8 秒后仍不可达（真正残留的进程），运行 `dsh-gui-stop.cmd` 清理即可。`dsh-gui.log` 每行现在带时间戳，可据此核对每次点击的时间线。
- **界面空白 / 样式不对**：确认 `apps/web/dist/index.html` 存在（见“一次性准备”第 2 条）。
- **新打开的窗口“历史加载失败：Failed to fetch（internal）”**：常见于**关窗后立刻再点图标**。旧服务仍在收尾（最多 4 秒才释放单写者锁），新窗口若此时“附接”到它，服务一退出新窗口就断。现已在关窗瞬间**摘掉锁里的 URL 和端口**（保留持有者声明以挡住双写）：落在收尾期内的新启动会原地等待旧服务退出，然后自动启动一个**全新**服务，不再附接到将死的服务（等待期间无窗口、最多几秒）。

## 已安装的社区插件

已装 4 个插件（除 dsh-automation 外全部），均安装在 Web profile（`~/.dsh/profiles/web`，在用户目录、**不在本仓库**——换机器后用下方命令重装）。**装完重启应用窗口生效**（服务重启时组合前端；界面没变化就硬刷新 Ctrl+F5）。

| 插件 | 安装命令 | 作用 |
|---|---|---|
| DSH-better-sidebar | `dsh plugin --profile web add git+https://github.com/omdsh-dev/DSH-better-sidebar.git` | VS Code 式侧边栏工作台：文件树、编辑器、真实终端、Git、Diff、后台任务页 |
| dsh-genui | `dsh plugin --profile web add git+https://github.com/omdsh-dev/dsh-genui.git` | 回复内渲染交互组件（图表/表格/Mermaid/3D/表单），支持回连模型 |
| dsh-at-file | `dsh plugin --profile web add https://github.com/omdsh-dev/dsh-at-file/archive/refs/heads/main.tar.gz` | 输入框 `@文件` 引用（Codex 风格，选中即注入文件内容，省一次工具调用） |
| ModLens | `dsh plugin --profile web add @liustack/modlens@3.12.1` | 给纯文本模型补“读图”能力（host 端插件，模型选择器会出现 `… (modlens vision)` 条目） |

注意：
- 这里的 `dsh` 即本副本的 `apps/cli/lib/bin.js`（`dsh-gui` 内部就是跑它）；
- pnpm ≥10 装 git 插件时会拦截构建脚本（node-pty 等原生模块），按 pnpm 提示把键加入 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 即可；
- ModLens 是高频发布的注册表包，被 pnpm 的 release-age 门禁拦到旧版时（旧版不声明 `dsh.bundle`、不会生效），显式钉版本号（即上面的 `@3.12.1`）；
- ModLens 的视觉通道配置在 `~/.modlens/config.json`（零配置默认走免费的 antigravity-cli；也支持 Gemini/通义等，配置项含 `proxy`，可指向本机代理）。

## 与主仓库的关系

- 上游：DeepSeek Harness 官方仓库（MIT 协议），只读参照，**未被修改**。
- 本仓库：独立工作副本 + 本 GUI 网关。所有产物（GUI 脚本、日志、PID）都在本目录内，不涉及任何上游外部路径。
- 需要原样恢复主仓库功能时忽略本目录即可；本目录不影响上游仓库的任何状态。