# fly-pet 项目拼装计划

> 依据 `docs/dev.md` 的选型结论制定。参考仓库已浅克隆到 `references/`（只读）；
> VPet（1.4GB）仅作在线参考，不克隆。全程不做 git 操作。

## 执行进度（2026-09-15，全部完成）

| 阶段 | 状态 |
|---|---|
| Phase 0 环境 | ✅ uv + Python 3.12 + flybrain 0.1.0（CPU/numba 0.67） |
| Phase 0 真脑验证 | ✅ LC4+LPLC2 左→DNp01-L **+25.3Hz**（对侧 0）；LC10a 左→DNa02-L **+4.7Hz**；**单步 2.6ms（378 步/秒）**；positions/superclass 可用。见 `brain-service/scripts/verify_result.json` |
| Phase 1 协议+接口 | ✅ protocol.py / backend.py / mock，23 单测全过 |
| Phase 2 brain-service | ✅ encoder/decoder/flyai/server；解码器阈值按实测校准（AVOID≥12Hz, 转向≥2.5Hz） |
| Phase 2 情景演示 | ✅ scripts/demo.py：左移光标→MOVE_LEFT；逼近→AVOID；点击→INTERACT；物体→嗅觉 |
| Phase 3 桌面壳 | ✅ NyaDeskPet fork + 光标传感器 + 窗口行走器 + SpriteAvatar；CDP 全链路验证：页面点击→IPC→WS→真脑→INTERACT |
| Phase 4 Brain Lab | ✅ **真实 MaleCNS 166,700 神经元坐标**点云 + DN 柱状图 + 辉光；实拍：looming→DNp01-L 21Hz→AVOID |
| Phase 5 README/demo | ✅ |

运行中的实测结论：本机 CPU 上大脑 40+ 步/秒（50Hz 模拟几乎实时），
真脑基线静默（~0Hz），刺激后单侧化放电，REST/IDLE/AVOID/INTERACT 行为符合设计。

## 技术选型决定

- **Python 版本：3.12**（uv 管理，自动下载独立 CPython）。依据：所有约束的交集中心——
  `flybrain`/numba `>=3.10`、`braintrace` `>=3.11`、JAX 最新版 `>=3.12`（已放弃 3.11）、
  FlyBrain CI 主测 3.12。选 3.10/3.11 会在第二阶段（braintrace 训练）卡死。
- **包管理：uv**（本机已有 v0.10.12）。项目根 `pyproject.toml` + `.python-version`，
  brain-service 为可安装包 `brain_service`（`uv sync` / `uv run`）。

## 调研结论（已验证事实）

| 参考 | 已验证的关键事实 |
|---|---|
| `fly.ai` + PyPI `flybrain` 0.1.0 | CPU 后端是 **numba**（macOS arm64 可跑，无需 N 卡，CuPy 仅 GPU 可选项）；API：`FlyBrain(device="auto")` → `brain.cells(["LC4","LPLC2"], side="L")` → `brain.step(inject=[(cells, 0.8)])` 返回放电神经元；首跑下载 ~260MB 到 `~/fly-data`（可用 `$FLY_DATA` 改路径）；CPU 单步 12–15ms（24 线程），50 步/秒实时可行 |
| `NyaDeskPet` | WebSocket 协议文档完整（`docs/API.md`，JSON + `type` 字段），自带 `tap_event`（触碰）与 `live2d` 控制消息，后端驱动模式正好适配 |
| `Jhongdlp/FlyBrain` | `web/src/cerebro.ts` 是 Three.js 连接体点云 viewer（16 万神经元粒子 + 放电辉光拖尾 + OrbitControls），可提取思路 |
| `TonyNa/desktop-pet` | `character.json` schema：精灵图 + row/frames/interval 状态表，自带 idle/左右跑/wave/jump 等 8 状态，MIT 素材可作默认角色 |
| `Shimeji` / `VPet` | 仅行为设计参考，不引入代码 |
| `braintrace` | 第二阶段训练用，V0 不动 |

fly.ai 的 `valentfly/`、`sshfighter/` 是两个完整的「编码器 → 全脑 → DN 读出」参考实现。

## 总体架构（V0）

```text
desktop/ (Electron, 取自 NyaDeskPet)
   ├─ DesktopSensor      鼠标移动/点击/拖拽/闲置/时间 → SensoryEvent
   ├─ AvatarRuntime      AvatarProvider 抽象: SpriteAvatar(默认) + Live2DAvatar(保留)
   └─ brain-lab/         Three.js 连接体 viewer (取自 FlyBrain cerebro.ts 思路)
        │ WebSocket (JSON)
brain-service/ (Python)
   ├─ sensory/           SensoryEvent → 神经元注入 (LC10a/LC4+LPLC2/触觉/ORN)
   ├─ backends/          BrainBackend 接口: flyai.py | mock.py
   ├─ decoder/           DN 放电率 → 8 个 BrainAction (DNa02/DNp01/DNg100/MDN)
   ├─ telemetry/         感官条 + DN 活动流
   └─ server.py          WS 服务
training/  simulator/    V0 仅占位目录
```

关键设计决策：`BrainBackend` 接口固定为
`reset / step / get_action / get_activity / save_state / load_state`。
fly.ai 无 plasticity，产品绝不绑死它；mock 后端让前端开发不依赖 260MB 大脑数据。

## 核心协议（第一版）

- `SensoryEvent`（8 种）：`mouse_move` / `mouse_approach` / `pet_click` / `pet_drag` /
  `object_appear` / `object_remove` / `idle_tick` / `time_tick`
- `BrainAction`（8 种）：`IDLE` / `MOVE_LEFT` / `MOVE_RIGHT` / `APPROACH` / `AVOID` /
  `LOOK` / `INTERACT` / `REST`
- `AvatarAction` 映射：idle / walk_left / walk_right / walk / run / look / touch(wave) / sleep
- WS 消息沿用 NyaDeskPet 的 JSON+`type` 约定，新增扩展：`brain_state`、`brain_telemetry`

神经通道映射（沿 fly.ai 已验证结论）：

```text
鼠标在某侧出现/移动   → LC10a (side)      求偶追踪目标神经元
鼠标快速逼近          → LC4 + LPLC2 (side) looming 逃避检测
点击宠物              → 触觉感官神经元
虚拟物体出现          → ORN 嗅觉受体神经元 (valentfly 模式)
```

输出解码（手工生物学映射，含迟滞去抖）：

```text
DNp01 放电率高        → AVOID (逃跑)
DNa02 左右不对称       → MOVE_LEFT / MOVE_RIGHT (转向)
DNg100 高             → APPROACH (前进)
MDN 高                → 后退（并入 AVOID 行为族）
LC10a 单侧持续+无逼近  → LOOK
最近有点击且无更高优先级 → INTERACT (wave)
全脑活动持续低迷        → REST (sleep)
其余                  → IDLE
```

## 实施阶段

### Phase 0 — 可行性验证（决策门）
建 venv → `pip install flybrain` → `flybrain download` → 复刻 `inject.py`：
左眼注入 LC4+LPLC2，确认 DNp01-L 放电率上升；**实测本机单步延迟**。
达不到实时（≥20 步/秒）则降大脑频率 + Avatar 动作插值。

### Phase 1 — 骨架 + 协议定义
建目录结构；协议写成代码 + 文档；`BrainBackend` ABC + mock 实现 + 单测。

### Phase 2 — brain-service
`sensory/` 编码器（事件→注入，节奏/疲劳/不应期参数）、`decoder/` 手工 DN 映射
（迟滞去抖）、`backends/flyai.py`、WS server、telemetry 环形缓冲流。
M1：mock 后端 + WS 协议跑通；M2：flyai 后端实测活脑。

### Phase 3 — 桌面壳
拷贝 NyaDeskPet → `desktop/` 并跑通；加 `DesktopSensor`（Electron 主进程全局光标轮询）；
加 `AvatarProvider` 抽象与 `SpriteAvatar`（character.json 格式 + desktop-pet MIT 素材）；
保留 Live2D provider。M3：宠物对鼠标有反应（mock 后端）。

### Phase 4 — Brain Lab
提取 FlyBrain `cerebro.ts` 点云渲染思路；神经元坐标取自 `~/fly-data`；
新 Electron 窗口 / 浏览器页：3D 连接体 + 实时活动 + 感官/DN 活动条。

### Phase 5 — 验收打磨
macOS arm64 全链路验证、demo 脚本（合成感官事件）、README。

## 主要风险与对策

1. **本机 CPU 算力**（最大不确定项）→ Phase 0 第一时间实测；降大脑频率 + 动作插值；
   step 与渲染天然解耦。
2. **NyaDeskPet 启动依赖**（可能要求 LLM key）→ 必要时 stub/裁剪，保留窗口/协议/渲染管线。
3. **8 个动作的素材缺口** → 先用 desktop-pet 素材映射，缺口动作用现有状态顶替。

## 里程碑

- M0 flybrain 在本机跑通（决策门）
- M1 brain-service mock 后端 + WS 协议
- M2 flyai 后端活脑运行
- M3 桌面宠物渲染 + 对鼠标反应（mock）
- M4 完整闭环（真实大脑驱动宠物 + Brain Lab 可见）
- M5 验收打磨
