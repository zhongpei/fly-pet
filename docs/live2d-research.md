# Live2D 能力研究与修正方案（2026-09-15）

> 背景：走路观感问题连续两次修补（bob、步进）仍未根治。用户指正：应先研究
> Live2D 模型全部能力与参考项目全部功能，再动手。本文是研究结论。

## 1. mao_pro 模型全部能力（实测解码）

### 1.1 参数：128 个，远不止头/眼/嘴

| 类别 | 参数 | 意义 |
|---|---|---|
| **整体** | ParamAllX / AllY / AllRotate | **整个角色在窗口内平移/旋转**（走路的关键） |
| 身体 | ParamBodyAngleX/Y/Z | 身体旋转（前倾/侧倾） |
| 头 | ParamAngleX/Y/Z | 头部（已用） |
| 眼 | EyeLOpen/ROpen/Smile/Form, EyeBallX/Y, EyeEffect | 开闭/笑眼/变形(怒目)/瞳孔/特效 |
| 眉 | BrowLY/RY/BrowLAngle/BrowLForm… | 怒眉/皱眉 |
| 嘴 | MouthUp / **MouthDown** / **MouthAngry** | 嘴角上扬(笑)/下垂(丧)/嘟嘴(生气) + 口型 A/I/U/E/O |
| 脸 | ParamCheek | **脸红** |
| 肩臂 | Left/RightShoulderUp, ArmL/R A+B 肩肘腕 | 耸肩、手臂姿势 |
| 道具 | WandRotate, InkDrop | 手杖、墨滴 |
| **移动感** | HairFront/Side/Back 摇动, RobeL/R 长袍摇动, Ribbon/HatBrim | **物理引擎自动驱动——移动时的飘动来自这里** |
| **魔法特效** | HeartDraw/HeartHealOn/HeartMissOn/彩虹、Aura 光环、Explosion 爆炸、Smoke 烟雾、StrengthenLight 强化光、Rabbit 兔子 | 角色专属魔法演出，可绑定大脑动作 |

### 1.2 表情文件（已逐一解码 exp3 内容）

| 文件 | 实际内容 | 应映射的情绪 |
|---|---|---|
| exp_01 | 全默认，睁眼 | neutral |
| exp_02 | EyeLOpen=0 + Smile=1（**弯成月牙的笑眼**） | content 满足 |
| exp_03 | 双眼全闭 | sleepy 困倦 |
| exp_04 | EyeLOpen=**1.2** + Smile=1（**星星眼**） | curious 好奇/兴奋 |
| exp_05 | 默认变体 | 备用 |
| exp_06 | **ParamCheek=1（脸红）** | 抚摸/害羞 |
| exp_07 | EyeLOpen=1.2 无笑（**瞪大眼**） | alert/scared 惊觉害怕 |
| exp_08 | **EyeLForm=1（怒目变形）** | annoyed 恼火/THREAT |

### 1.3 动作：7 个全部是上半身表演（3.5~9.4s，循环）

**没有走路循环，也没有腿部参数——Live2D 模型物理上不可能"迈步走路"。**
（Idle 1 个 + 通用 4 个 + special 3 个大型演出）

## 2. 参考项目的成熟方案

### NyaDeskPet live2d-manager（~1400 行，不应重造）
- `playMotion / setExpression / lookAt(x,y)平滑注视 / tap命中区域 / 口型同步`
- **setParameter(s) 参数覆写系统**：带 blend 混合权重和 duration 时长，
  与 idle 动作共存不冲突——正是手写 `setParameterValueById` 缺的东西
- `executeSyncCommand`：组合指令（动作+表情+参数一键同步）
- **现成的 `live2d` WS 协议**（docs/API.md）：`{"command":"motion|expression|parameter", ...}`
  ——brain-service 应当直接说这个协议，而不是自创 `brain_state`
- `param-map.json` 语义别名、`extractModelInfo` 能力上报

### TonyNa desktop-pet / Shimeji
- 窗口移动机制与我们相同（setBounds/setPosition）；
  它们看起来"在走"是因为 sprite 有真走帧——**上半身 Live2D 模型做不到**，
  必须接受"平移 + 身体语言"的折衷，并把折衷做满。

## 3. 修正方案

### 3.1 走路观感（核心修正）
真"迈步"不可能，改为"**重心先行 + 物理飘动**"的完整组合：
1. `ParamAllX`：身体朝移动方向**探出 6~10**（重心前移，起步感）
2. `ParamBodyAngleZ` + `ParamAllRotate`：移动方向倾斜 3~5°
3. 步进式窗口移动（已实现）+ bob（已实现）保持
4. **头发/长袍/帽子的飘动交给物理引擎**：ParamAllX/Y 的快速变化会自动
   触发 physics3.json 摇动——这才是移动感的最大来源，之前完全没用上
5. 停下时 ParamAllX 回弹 0，长袍头发自然甩动收尾

### 3.2 表情映射（换成真表情文件 + 嘴/眉参数）
- 表情改用 model.expression() 播放 exp 文件（exp_02/03/04/06/07/08 逐一对应）
- 叠加嘴部参数：annoyed→MouthAngry、content→MouthUp、scared→MouthOpen
- 叠加眉部：annoyed→BrowForm 怒眉

### 3.3 魔法特效 = 动作的视觉签名（这个模型的独特优势）
| BrainAction | 特效演出 |
|---|---|
| JUMP | Explosion + Smoke（惊跳爆炸） |
| THREAT | StrengthenLight 强化光环 + 怒目 + MouthAngry |
| INTERACT/抚摸 | HeartDrow/HeartHealOn 爱心 + exp_06 脸红 |
| AVOID | Smoke 残影 |
| APPROACH | 心形魔法位置跟随 |

### 3.4 协议收敛
brain-service 增发 NyaDeskPet 兼容的 `live2d` 消息（parameter 批量 + motion +
expression），桌宠端把 brain 输出接进 live2d-manager 的 setParameters/
executeSyncCommand 管线，替换手写的逐帧覆写。

## 4. 实施顺序（待确认后执行）
1. Live2DAvatar 改接 NyaDeskPet 管线（parameter override + expression 文件）
2. 走路组合（ParamAllX 探出 + 倾斜 + 物理飘动 + 步进 + bob）
3. 魔法特效绑定（JUMP/THREAT/INTERACT/AVOID）
4. 全动作视觉回归（截图 + 窗口位移断言，扩展 test_walk.py 覆盖全部 15 动作）
