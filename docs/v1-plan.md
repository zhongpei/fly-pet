# fly-pet V1 设计：动作、表情与连续控制

> 决策记录（2026-09-15 讨论）：
> 动作扩展**生物优先**（只接连接体里有明确命令神经元/命名群体的行为）；
> 表情载体 **Live2D 为主**（sprite 作轻量 fallback）；**连续参数层进 V1**。

## 1. 三层输出架构

```text
真脑 DN 放电率（每步）
   │
   ├─① 连续参数层   speed / head_angle / gaze / arousal     ← 速率直接映射
   ├─② 离散动作层   14~16 个动作（V0 的 8 个 + 新增）         ← 阈值 + 迟滞
   └─③ 表情层       arousal × valence → 情绪状态 → Live2D    ← 新增
```

WS 协议 v2：`brain_state` 增加 `intensity`、`params:{speed, head_angle}`、
`expression`；新增 `brain_emotion` 消息（arousal/valence/状态名）。

## 2. 离散动作词汇表（生物优先，通道已在数据中确认）

### 2.1 已有（V0 保留）

| 动作 | 通道 | 说明 |
|---|---|---|
| IDLE / LOOK / INTERACT | LC10a / 触觉 | 保持 |
| AVOID | DNp01 持续放电 | 巨轴索逃逸 |
| APPROACH | LC10a + DNg100 | 改名 WALK+朝向，语义并入连续层 |
| REST / MOVE_LEFT / MOVE_RIGHT | 静默 / DNa02 | MOVE_* 并入 STEER 连续层，保留极端档 |

### 2.2 新增（V1 核心）

| 动作 | 生物学通道（数据实测） | 判定逻辑 | Avatar |
|---|---|---|---|
| **JUMP 惊跳** | DNp01 **短脉冲**（<400ms 消退） | 与 ESCAPE 区分：脉冲时长 | jumping（素材已有） |
| **THREAT 威胁** | **pIP10**（雄性扇翅威胁命令神经元，L1/R1，已确认） | pIP10 侧 EMA 超阈值；反复被戳后 valence− 累积更易触发 | 生气/扇翅动画 |
| **WING_DISPLAY** | DNp10（L1/R1，已确认） | 探索性阈值 | 得意展示 |
| **BACK** | MDN（L2/R2） | MDN EMA 超阈值 | 后退步 |
| **WANDER 闲逛** | 无注入时的自发网络活动 | 静默桌面 + DN 群体自发不对称 | 随机小踱步 |
| **GROOM 打理** | DNg01（9）/ DNg09（8）群体放电模式 | 命名神经元、行为对应为探索性，decoder 里可开关 | 舔手/捋毛 |
| **TURN_AWAY** | DNa03（L1/R1，命名通道，功能映射探索性） | 与 DNa02 反号 + LC10a 低 | 转身背对 |

> 诚实边界：aDNc01/aDNc02（求偶歌 DN）不在 MaleCNS 注释中，求偶类动作 V1 不做；
> GROOM/TURN_AWAY/WING_DISPLAY 属"命名通道、行为解释探索性"，在配置中标记 `speculative: true`。

## 3. 连续参数层

| 参数 | 来源 | 映射 |
|---|---|---|
| `speed`（0~1） | DNg100 EMA | 行走动画帧率 + 窗口移速（60~300px/s 线性） |
| `head_angle`（−30°~30°） | DNa02 L−R 不对称（平滑、限幅） | Live2D `ParamAngleX`（已有别名 head_turn_x） |
| `gaze_side` | LC10a 强度重心 | 眼球/头部微偏 |
| `arousal`（0~1） | 全脑 DN 总率 + 感官能量（双 EMA，快升慢降） | 表情强度、动作幅度 |

## 4. 表情层

情绪空间 = **valence（−1~+1）× arousal（0~1）**：

```text
valence V1 启发式（V2 接 PAM/PPL1 可塑性后变成学出来的）：
  + ：长按抚摸、食物物体、安静陪伴
  − ：looming、反复被戳、苦味物体
  自然衰减 → 0

情绪状态 → Live2D：
  neutral   平静       EyeLOpen 1.0, AngleX 0
  content   满足       valence+ 低觉醒：半眯眼、微微笑
  curious   好奇       valence+ 高觉醒：LC10a 活跃，眼随鼠标
  alert     惊觉       arousal 突升：睁大（EyeLOpen 1.2 短脉冲）
  scared    害怕       valence− 高觉醒：DNp01 活跃
  annoyed   恼火       valence− 中觉醒：pIP10/THREAT 相关
  sleepy    困倦       低觉醒 + REST：EyeLOpen 渐闭
```

Live2D 集成路径：复用 NyaDeskPet 的 pixi-live2d-display 依赖与 `models/nya`
模型、`param-map.json` 语义别名；flypet 页新增 Live2DProvider，直接把
`params` 写入模型参数（不经过 NyaDeskPet 的 dialogue 控制器）。Sprite
Provider 保留，表情退化为切换表情行/气泡。

## 5. 配套新感官事件

| 事件 | 编码 | 期望行为 |
|---|---|---|
| `pet_double_click` | DNp01 强短脉冲 | JUMP 惊跳 |
| `pet_long_press`（≥600ms） | 触觉持续 + valence+ | 抚摸：满足/眯眼（未来接 PAM 奖励） |
| `object_appear{class}` | food→甜味 ORN；rival→**cVA→ORN_DA1**（valentfly 同款） | 接近食物；情敌气味→THREAT |
| `keyboard_activity` | LC10a 弱注入 | 好奇看键盘 |
| `time_tick`（带时刻） | 昼夜节律系数 | 夜间更易 REST（可选） |

## 6. 实施拆分

1. **校准先行**：扩展 `verify_flybrain.py`，逐一注入测量 pIP10 / MDN /
   DNg01 / DNg09 / DNp10 / DNa03 对刺激的响应曲线，产出阈值依据
   （同 V0 的做法，避免拍脑袋阈值）。
2. **协议 v2 + 连续参数层**（speed/head_angle/arousal 进 telemetry 与
   brain_state）。
3. **Live2DProvider** + 情绪启发式 + 表情映射。
4. **新动作**：JUMP、BACK、THRAFT（THREAT）、WANDER，然后 GROOM/
   WING_DISPLAY/TURN_AWAY（speculative 开关）。
5. **新感官事件**：双击/长按/物体分类/键盘。
6. 每步保持：单测更新 + demo 脚本扩展 + mock 后端同步支持（mock 造出
   对应通道的假放电）。
