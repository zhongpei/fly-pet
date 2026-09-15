# fly-pet

用真实果蝇大脑（MaleCNS 连接体，**166,700 神经元 / 2,560 万突触**）驱动的桌面宠物。

大脑本身不训练、不查表：桌面事件编码成感觉神经元注入（LC10a / LC4+LPLC2 / 触觉 / 嗅觉），
每次前向传播真实的连接体权重矩阵，从下行神经元（DNa02 / DNp01 / DNg100 / MDN）的放电率
解码出 8 个动作之一，驱动精灵（或 Live2D）角色。

完整设计见 `docs/dev.md`（选型）与 `docs/plan.md`（拼装计划）。

## 架构

```text
desktop/ (Electron, fork 自 NyaDeskPet, MIT)
   ├─ src/flypet/link.ts        WS 客户端 + 全局光标传感器 + 窗口行走器
   ├─ src/flypet/sensor.ts      光标采样 → 语义感官事件（纯逻辑）
   └─ renderer/flypet.html      SpriteAvatar 页面（character.json + sprite.png）
        │ WebSocket ws://127.0.0.1:8020/ws (JSON, type 字段)
brain-service/ (Python 3.12, uv 管理)
   ├─ protocol.py               SensoryEvent / BrainAction / AVATAR_ACTION_MAP
   ├─ sensory/encoder.py        事件 → 神经通道注入强度
   ├─ backends/flyai.py         flybrain MaleCNS（numba CPU / CuPy GPU）
   ├─ backends/mock.py          无数据开发用玩具脑
   ├─ decoder/dn_decoder.py     DN 放电率 → 8 动作（迟滞去抖，AVOID 可抢占）
   ├─ telemetry.py + server.py  aiohttp WS 服务 + Brain Lab 静态页
   └─ brain_lab/                Three.js 连接体点云 + 实时神经活动
training/  simulator/           （第二阶段占位）
references/                     参考仓库只读克隆（fly.ai、FlyBrain、NyaDeskPet 等）
```

## 快速开始

```bash
# 1. 大脑服务（先用玩具脑，无需下载数据）
uv sync
uv run flypet-serve --backend mock          # ws://127.0.0.1:8030 默认 8020

# 2. 真脑模式（首次自动下载 ~260MB 到 ~/fly-data）
uv run flypet-serve --backend flyai

# 3. 桌面宠物（默认 flypet 精灵模式；--nya 回到原 NyaDeskPet 模式）
cd desktop
npm install                                 # 已装过可跳过
npm run compile
FLYPET_BRAIN_URL=ws://127.0.0.1:8020/ws npx electron .

# 4. Brain Lab（浏览器打开，实时 3D 连接体 + 神经活动条）
open http://127.0.0.1:8020/lab/
```

## 感官 → 动作（V0 语义）

| 桌面事件 | 神经通道 | 典型反应 |
|---|---|---|
| 光标在某侧出现/移动 | LC10a（同侧） | LOOK / MOVE（DNa02 不对称） |
| 光标快速逼近 | LC4 + LPLC2（同侧） | AVOID（DNp01 巨轴索，可抢占） |
| 点击宠物 | 触觉群体 | INTERACT（挥手） |
| 虚拟物体出现 | ORN 嗅觉群体 | 嗅觉反应（MDN/DNg100） |
| 桌面长时间安静 | 无注入 | REST（低头打盹） |

动作集合：`IDLE / MOVE_LEFT / MOVE_RIGHT / APPROACH / AVOID / LOOK / INTERACT / REST`，
映射到精灵状态 `idle / runningLeft / runningRight / running / review / waving / failed`。
行走/逃跑时主进程真的会移动窗口（APPROACH 朝光标、AVOID 背离光标加速跑）。

## WS 协议（摘要）

客户端 → 服务：`{"type":"sensory_event","kind":"mouse_move","x":-0.8,"side":"L"}`
（kind 另有 `mouse_approach` / `pet_click` / `pet_drag` / `object_appear` / `object_remove`）

服务 → 客户端：
- `brain_state`：`{"action":"AVOID","avatar":"run"}`（动作变化即推送）
- `brain_telemetry`（10Hz）：`{"rates":{"DNp01_L":141.0,...},"stim":{...},"steps_per_s":39}`

## 测试与验证

```bash
uv run pytest                      # 23 个单测（协议/编码器/解码器/mock/WS 集成）
uv run python brain-service/scripts/verify_flybrain.py   # 注入验证 + 本机延迟实测
uv run python brain-service/scripts/demo.py              # 合成情景演示
```

## 致谢与许可

- [fly.ai / flybrain](https://github.com/alextitonis/fly.ai)（MIT）— 大脑运行时；连接体数据 MaleCNS v1.0（CC BY 4.0，HHMI Janelia）
- [NyaDeskPet](https://github.com/gameswu/NyaDeskPet)（MIT）— 桌面壳
- [Jhongdlp/FlyBrain](https://github.com/Jhongdlp/FlyBrain)（MIT）— Brain Lab 点云渲染思路
- [TonyNa-code/desktop-pet](https://github.com/TonyNa-code/desktop-pet)（MIT）— 角色包格式与默认素材
