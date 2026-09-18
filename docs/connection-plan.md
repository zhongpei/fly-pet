# V1.3 人物 ↔ 大脑完整连接（已实现）

> 分析两边各自的全部通路，建立完整连接。打字（user_input）按决定不接；
> 环境感知（键盘 hook、昼夜节律）留待以后。

## 1. 大脑的全部通路（flybrain 实测）

### 1.1 感觉输入通道（→ 连接组）

| 通道 | 初级脑 | 生物学含义 | 来源 |
|---|---|---|---|
| chase_L/R | LC10a | 同侧移动的小目标（追视） | 鼠标位置（CursorSensor 80ms） |
| loom_L/R | LC4+LPLC2 | 快速逼近的阴影（天敌） | 鼠标快速逼近、双击惊跳 |
| touch_L/R | 机械感受群体 | 体表接触 | 点击/抚摸/被抓住 |
| odor | ORN | 气味（食物/对手/玩具浓度不同） | 虚拟物体（预留） |

### 1.2 下行命令神经元（连接组 → 行为）

| 神经元 | 行为 | 实测标定 |
|---|---|---|
| DNp01 | 惊跳/逃飞（giant fiber） | loom 侧 +25.3Hz |
| DNa02 L/R | 转向（头部朝向差） | chase +4.7Hz |
| DNa03 L/R | 转身离开 | 直接驱动 |
| DNp10 | 展翅求偶鸣唱 | 直接驱动 |
| pIP10 | 振翅威胁 | 直接驱动 |
| DNg100 | 前进速度（连续量） | speed=DNg100/30 |
| DNg01/DNg09 | 理毛 | 直接驱动 |
| MDN | 后退 | 直接驱动 |

### 1.3 内部状态（连接组之外，情绪引擎）

- **arousal**：脑活动+感觉能量的快攻慢衰 EMA
- **valence**：事件累积器（抚摸/摸头+，戳/逼近−，12s/3 击烦躁窗）
- **内驱力**：threat/retreat/groom/display → 注入上面的命令神经元（行为仍从大脑涌现）
- 输出：7 情绪（neutral/content/curious/alert/scared/annoyed/sleepy）+ 连续参数（speed/head_angle/intensity）

## 2. 人物的全部通路（mao_pro 实测解码）

| 层 | 清单 |
|---|---|
| 动作 | Idle ×1 + 通用 ×3（mtn_02..04）+ 大型演出 ×3（special_01..03），全部上半身，无腿部 |
| 表情 | exp_01 正常 / 02 笑眼 / 03 闭眼 / 04 星星眼 / 06 脸红 / 07 瞪眼 / 08 怒目 |
| 128 参数 | 整体 AllX/AllY/AllRotate；身体 BodyAngleXYZ；头 AngleXYZ；眼/眉/嘴（MouthAngry 嘟嘴等）；脸颊红晕；呼吸；手臂；头发/长袍物理 |
| 魔法特效 | Explosion（爆炸）、StrengthenLight（强化光）、Aura（光环）、Smoke（烟雾）、HeartHeal/Drow（爱心）、HeartLight（星星）、Rabbit —— 均为 `*On` 显示+演出参数，配合 blend+duration 可"闪现后自动消失" |
| 窗口层 | 步进行走（步频=5.5+7×speed Hz）、拖动、总在最前 |
| 气泡 | dialogueManager（dialogue 消息 → 文字气泡） |

## 3. 完整连接矩阵

### 3.1 人物/环境 → 大脑（感觉侧）

| 你的操作 | 事件（协议） | 编码为通道 | 大脑里发生什么 |
|---|---|---|---|
| 点头部（模型上 38%） | pet_click cls=head | touch 脉冲 + head_pat | valence+0.12、**赦免一次烦躁**、1.2s 理毛驱动（蹭脸反应） |
| 戳身体 | pet_click cls=body | touch 脉冲 | 烦躁+1、valence−0.05 |
| 快速连点两下 | 两次 pet_click <350ms | 双侧 loom 1.0/0.12s | LC4+LPLC2→DNp01 惊跳 |
| 按住不放 ≥600ms | pet_long_press/release | touch 0.45 持续 | valence 每秒+0.35、抚摸安全释放 10s |
| 抓住拖走（拖窗口） | pet_held / pet_held_release | touch 0.8 持续 | valence−0.15、**MDN 后退 0.9s + pIP10 威胁 0.6s**（挣扎）；行走器让位 |
| 鼠标移动/逼近 | mouse_move / mouse_approach | chase / loom | 追视 / 逃跑 |
| 一直不理 | desktop_quiet | 无 | 自发 WANDER/GROOM（8s 起） |

实现位置：几何触觉路由在 `desktop/src/main.ts` FLYPET_TOUCH_JS（executeJavaScript 注入，
参考项目文件零改动；mao_pro 的 hitArea 未绑定 moc、manager 恒报 'unknown'，故按模型
包围盒相对高度判定头/身）；held 状态机在 `desktop/src/flypet/link.ts`。

### 3.2 大脑 → 人物（运动/表达侧）

| 大脑输出 | 动作 | 特效（闪现） | 台词（气泡，4s 节流不重复） |
|---|---|---|---|
| JUMP（DNp01 惊跳） | **Idle + 窗口急窜**（scurry） | **Explosion** | "呀！！/吓我一跳！" |
| THREAT（pIP10） | mtn_04 挥臂拍击（FORCE） | **StrengthenLight** | "别戳我！/哼！生气了！" |
| WING_DISPLAY（DNp10） | mtn_02 双臂/展翅举起（FORCE） | **Aura** | "听我唱歌：嗡嗡嗡" |
| AVOID | **Idle + 窗口急窜** | **Smoke 残影** | "好险好险！" |
| GROOM | mtn_03 摇头梳理（FORCE） | — | "理理毛，梳梳妆" |
| INTERACT | mtn_02 双臂欢呼（FORCE） | 摸头/抚摸 → **HeartHeal 爱心** | "一起玩吧！" |
| 抚摸中 | content exp_02+MouthUp+Cheek | Heart | "……好舒服，别停" |
| 摸头 | valence↑ | — | "再摸摸~/呼……好舒服" |
| 被抓住 | BACK+THREAT 挣扎（窗口不溜） | — | "哇！放开我！" |
| 移动类（walk/run/back/wander） | **Idle——不演戏**，窗口步进+bob+物理飘动 | — | 各配 2 句 |
| TURN_AWAY | Idle + AllRotate 转身背对光标 | — | "哼，不想理你了" |
| 连续参数 10Hz | 头转 AngleX/EyeBallX + 步态 AllY/AllX/BodyAngleZ/AllRotate + 物理飘动 | — | — |
| 情绪变化 | exp_01–08 表情文件 + 嘴/眉参数 | — | — |

## 3.3 移动修复（方案 A，2026-09-15 落地）

背景：用户反馈"移动有问题"。分析结论（证据见 git 历史）：参考项目**从不移动
窗口**（全项目无 setPosition/setBounds），窗口行走是 FlyPet 自建层；此前该层
有三处硬伤 + 一处衍生问题，全部修复：

1. **动作错配**：移动行为曾映射到 special 魔法演出（groom 播 9.4s 爆炸魔法、
   walk 播挥帽挥臂）。修复：移动一律 Idle（走路感=窗口步进+bob+头发长袍物理
   飘动，与原版"原地自然动画"哲学一致）；手势只留给静止行为，并解码动作文件
   后按内容重映射（mtn_02 欢呼→INTERACT/DISPLAY，mtn_03 摇头→GROOM，
   mtn_04 拍击→THREAT），special_01–03 保留不用。
2. **方向打架（bug）**：窗口方向由 walkVx（动作+光标）决定，身体倾斜却由
   head_angle（追光标）决定——逃跑时身体朝逃离方向的反面倾。修复：decoder
   新增权威方向输出 `params["dir"]∈{-1,0,1}`（APPROACH 向光标、逃跑背光标、
   WANDER 记住起 wander 时随机选的方向、escape_dir 记忆居中前的光标侧），
   行走器和身体倾斜/转身（AllRotate）全部只读这一个值。
3. **bob 混叠**：bob 频率 5.5-12.5Hz 超过 10Hz 参数流的奈奎斯特上限。修复：
   步频/bob 统一降到 2.2+2.3×speed（≤4.5Hz），幅度加大补偿。
4. **惊跳迈不出步（衍生 bug）**：JUMP 存活仅 ~50-100ms，慢步频下一连忙不完
   第一步就被 IDLE 重置。修复：JUMP/AVOID 走"急窜"模式（12Hz 碎步 + 收到指令
   当 tick 立即迈第一步）。
5. **手势打断**：一次性手势（欢呼/拍击/梳理/展翅）用 pixi-live2d-display
   priority 3 (FORCE) 下发，保证动作切换真正生效；Idle 切换保持 priority 2，
   不会掐断正在表演的手势。

验证（CDP 真实输入 + manager spy）：双击→JUMP dir=-1、窗口左移 97px、
AllX=-3.6/AllRotate=-3.3 同向、动作保持 Idle；摸头/戳身/抚摸路径回归通过；
64 pytest 全过。

实现位置：`brain_service/nya_map.py`（ACTION_LINES/EVENT_LINES/EFFECT_PARAMS）、
`brain_service/server.py`（broadcaster 节流下发 + outbox 一次性事件）。

## 4. 验证记录（2026-09-15，CDP 真实输入事件）

| 用例 | 结果 |
|---|---|
| 摸头 | groom 驱动 0.5 出现、烦躁清零、"呼……好舒服" |
| 戳身体 ×3 | annoyance=3 → annoyed 表情 → THREAT |
| 长按 1.2s | pet_long_press/release、Heart 命令、"……好舒服，别停" |
| 抓住（sim 拖动） | pet_held→retreat 0.55+threat 0.6（BACK/THREAT）→静默 500ms→pet_held_release |
| 双击 | 升级惊跳脉冲（单测），Explosion 参数到达 manager.setParameters |
| 特效/连续参数 | manager 侧 spy 实录：Explosion/StrengthenLight + 10Hz 参数流 |
| 回归 | 54 pytest 全过 |

## 5. 未接（明确不做/后议）

- **打字 user_input**：按决定不接（server 分支注释保留）。
- **键盘活动 hook**：需 macOS 辅助功能授权，encoder 通道已就绪。
- **昼夜节律**：果蝇昼行性（晨昏活动峰）可作为 arousal 的调制器，后议。
- **语音/TTS 嘴型**：管线在，需要 TTS Provider，成本高。
