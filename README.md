# fly-pet

用真实果蝇大脑（MaleCNS 连接体，**166,700 神经元 / 2,560 万突触**）驱动的桌面宠物。

大脑本身不训练、不查表：桌面事件编码成感觉神经元注入（LC10a / LC4+LPLC2 / 触觉 / 嗅觉），
每次前向传播真实的连接体权重矩阵，从下行神经元（DNa02 / DNp01 / DNg100 / MDN / pIP10 …）
的放电率解码出动作、连续参数与表情，驱动 Live2D 或精灵角色。

完整设计见 `docs/dev.md`（选型）、`docs/plan.md`（V0 拼装）、`docs/v1-plan.md`（V1 设计）。

## V1 新增

- **连续参数层**：DNg100 → 行走速度渐变；DNa02 左右不对称 → 头部实时朝向（Live2D ParamAngleX）；
  全脑活动 → 觉醒度 arousal
- **新动作**（生物优先，通道均已实测校准，`scripts/calibrate_channels.py`）：
  JUMP 惊跳（DNp01 短脉冲）、BACK 后退（MDN）、**THREAT 威胁**（pIP10，被戳烦了会冲你示威）、
  WING_DISPLAY（DNp10）、GROOM（DNg01/09）、TURN_AWAY（DNa03）、WANDER（自发探索）——
  后四者为探索性映射，`--speculative` 开关
- **情绪层**：valence × arousal 七种表情（满足/好奇/惊觉/害怕/恼火/困倦/平静），
  Live2D 语义参数承载（`param-map.json`）
- **新感官**：双击（惊吓）、长按（抚摸，valence+）、物体分类（食物接近 / 情敌信息素示威）、
  键盘活动（好奇）
- **Live2D 形象**：`--live2d` 切换（默认 sprite）

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

# 3. 桌面宠物（默认 Live2D 形象；--sprite 切精灵；--nya 回到原 NyaDeskPet 模式）
cd desktop
npm install                                 # 已装过可跳过
npm run compile
FLYPET_BRAIN_URL=ws://127.0.0.1:8020/ws npx electron .

# 4. Brain Lab（浏览器打开，实时 3D 连接体 + 神经活动条）
open http://127.0.0.1:8020/lab/
```

## 感官 → 动作（V1 语义）

| 桌面事件 | 神经通道 | 典型反应 |
|---|---|---|
| 光标在某侧出现/移动 | LC10a（同侧） | LOOK / MOVE（DNa02 不对称→头部转向） |
| 光标快速逼近 | LC4 + LPLC2（同侧） | AVOID（DNp01 持续）/ JUMP（DNp01 短脉冲） |
| 单击宠物 | 触觉群体 | INTERACT（挥手），多次戳→恼火 |
| 双击宠物 | DNp01 强脉冲 | JUMP 惊跳 |
| 长按宠物 | 触觉持续 | 抚摸：满足（valence+） |
| 虚拟物体 food/rival | ORN 气味群体 | 接近食物；情敌→示威后退 |
| 桌面长时间安静 | 无注入 | WANDER 闲逛 → REST（低头打盹） |

动作集合（15）：`IDLE / MOVE_LEFT / MOVE_RIGHT / APPROACH / AVOID / LOOK / INTERACT /
REST / JUMP / BACK / THREAT / WING_DISPLAY / GROOM / TURN_AWAY / WANDER`。
行走/逃跑时窗口真实移动（速度由 DNg100 连续控制）。

探索性动作（GROOM / WING_DISPLAY / TURN_AWAY）默认开启——通道真实存在、行为解释为
探索性；`--strict` 可关回文献严格模式。

> 形象说明：默认 Live2D（表情/头部追踪/眨眼呼吸等参数层完整）。
> 精灵（`--sprite`）受 8 行素材所限，15 个动作中有 11 个与其他动作共用素材
> （详见 `docs/v1-plan.md` 已知局限），表现力远弱于 Live2D。

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
