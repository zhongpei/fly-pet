我会明确选：**`fly.ai` 作为“果蝇大脑运行时”的主底座，`Jhongdlp/FlyBrain` 作为可视化和训练环境设计的代码来源；桌面应用则 fork `NyaDeskPet`。**

不是三选一，而是把三个项目各取最成熟的部分。这是目前最快形成可运行产品、同时不堵死后续训练的组合。

## 1. 两个果蝇项目里，为什么选 `fly.ai`

对我们现在的桌宠目标，差异已经很明显：

| 项目               | `fly.ai`                               | `Jhongdlp/FlyBrain`       |
| ---------------- | -------------------------------------- | ------------------------- |
| 完整 MaleCNS       | **166,700 neuron / 25.6M connections** | ~164,506 neuron           |
| 独立 Brain library | **非常好，已有 `flybrain` PyPI 包**           | 有 Python fly 模块，但项目围绕游戏组织 |
| GPU              | **CuPy，官方已有 CUDA backend**             | Python sparse LIF         |
| Batch 多个脑        | **已有 `batch=N`**                       | 重点是 VecEnv                |
| 换成桌宠任务           | **设计目标就是换 task**                       | 要拆掉 combat engine         |
| Encoder API      | **已经抽象出来**                             | 更偏 43D combat observation |
| Readout          | **已有通用 reservoir/readout**             | action 主要是项目专用            |
| 当前大脑训练           | 不训练                                    | 有局部 dopamine plasticity   |
| 3D neural viewer | 有 dashboard，但较简单                       | **非常强**                   |
| 高速 RL 环境         | 一般                                     | **极强，Rust VecEnv**        |
| License          | MIT                                    | MIT                       |

`fly.ai` 本身的架构已经明确成：

```text
task input
   ↓
encoder
   ↓
MaleCNS
166,700 neurons
   ↓
descending neurons
   ↓
decoder / readout
   ↓
task output
```

而且作者专门把 SSH Fighter 的公共部分抽成了 `flybrain/reservoir.py`，就是为了让其他任务复用；目前完整 connectome 在 RTX 4060 上作者报告单 step 约 1.4 ms，GPU 显存约 210 MB，并支持 batch 多只 fly。([GitHub][1])

这几乎就是我们要的：

```text
desktop event
    ↓
encoder
    ↓
fly.ai
    ↓
decoder
    ↓
desktop pet
```

所以：

> **不要 fork SSH Fighter。直接依赖 `flybrain` package。**

这样更干净。

[fly.ai GitHub](https://github.com/alextitonis/fly.ai?utm_source=chatgpt.com)

---

# 2. `Jhongdlp/FlyBrain` 不丢掉，重点拿两个东西

这个项目真正值得我们拿的是：

**① 3D connectome visualization**

它已经有 TypeScript + Three.js 的完整 3D connectome viewer、retina viewer 和 neural telemetry。([GitHub][2])

这正好做我们的：

```text
Normal mode
桌面宠物

        ↓ 点击 Debug Brain

Lab mode
┌─────────────────┬─────────────────┐
│ Desktop Pet     │ 3D Connectome   │
│                 │                 │
│    humanoid     │ ● ● ● ● ●      │
│                 │   ● ● ●         │
├─────────────────┼─────────────────┤
│ sensory input   │ neural activity │
│ mouse   ████    │ DNp01 █████     │
│ touch   ██      │ DNa02 ███       │
└─────────────────┴─────────────────┘
```

**② 以后训练时使用它的 headless environment 思路**

它把环境写成纯 Rust：

```text
step(world, input, action)
```

然后通过 PyO3 暴露 Python VecEnv，作者报告 headless 可以超过 100 万 step/s。([GitHub][2])

我们现在**完全不需要这个 engine**。

但未来训练电子宠物：

```text
find owner
avoid danger
choose object
approach food
remember location
```

不能拿真实桌面慢慢训练。

届时可以做：

```text
真实桌面环境
      ↑
      │ replay learned brain
      │
训练用模拟世界
Rust headless world
× 1000 environments
```

这个思想非常重要。

因此：

> `FlyBrain` 是我们的 **Visualizer + Future Training Environment Reference**，不是主 Brain Runtime。

[Jhongdlp/FlyBrain](https://github.com/Jhongdlp/FlyBrain?utm_source=chatgpt.com)

---

# 3. 桌面宠物底座：我现在最推荐 `NyaDeskPet`

我搜索了一批现在仍然比较新的开源桌宠以后，最符合我们的不是从零写 Tauri/PixiJS，而是：

### `gameswu/NyaDeskPet`

它已经有：

* Windows / macOS / Linux
* Electron
* Live2D
* 透明无边框窗口
* 鼠标触碰
* 表情 / 动作
* TTS
* AI Agent
* Plugin
* MCP
* **前端 / backend WebSocket 完全解耦**
* MIT License

尤其最后一点非常关键。

项目本身就是：

```text
Desktop Renderer
       │
    WebSocket
       │
Agent Backend
```

任何 WebSocket client 都能接进去。([GitHub][3])

我们直接把它变成：

```text
NyaDeskPet
 Desktop Renderer
       │
       │ WebSocket
       ↓
 FlyBrain Service
   Python
       │
       ↓
   fly.ai
```

这意味着我们几乎不用修改它的 Electron 基础设施。

[NyaDeskPet GitHub](https://github.com/gameswu/NyaDeskPet?utm_source=chatgpt.com)

---

# 4. 但是 Avatar 系统不要锁死在 Live2D

这是我要修改 `NyaDeskPet` 的第一件事。

因为你说得非常对：

> **不是一种生命形式。**

可以是：

```text
人
机器人
高达
猫
虫
史莱姆
抽象几何生命
像素角色
```

所以定义：

```text
AvatarProvider
```

然后支持：

```text
SpriteAvatar
Live2DAvatar
GIFAvatar
WebPAvatar
SpineAvatar     # 后面
```

这里可以直接借另一个项目的思路。

---

# 5. `TonyNa-code/desktop-pet` 很适合抄 Avatar Package

这个项目没有 NyaDeskPet 那么好的 backend 分离，但它的**角色资源格式非常符合我们**。

每个角色就是：

```text
assets/characters/
  my_pet/
    character.json
    sprite.png
    preview.png
```

`character.json` 描述：

* 动作
* frame 数
* 播放速度

目前基础动作包括 idle、左右跑、wave、jump 等。([GitHub][4])

而且跨 Windows/macOS/Linux，Electron，MIT。([GitHub][4])

所以我会：

> **NyaDeskPet 做 application shell；TonyNa 的 character pack 思路做 Avatar API。**

[TonyNa desktop-pet](https://github.com/TonyNa-code/desktop-pet?utm_source=chatgpt.com)

这样以后 AI 生成角色非常容易。

---

# 6. VPet 也值得参考，但不建议作为我们的核心底座

`LorisYounger/VPet` 是成熟度最高的一批桌宠项目之一，约 6.8k stars，而且已经有：

* 完整桌宠交互；
* 大量动作；
* 食物/饮料；
* 工作；
* MOD；
* 插件；
* Steam Workshop；
* 自定义动画；
* 可以增加 Live2D/Spine 等 renderer。

它甚至有独立 `VPet.ModMaker` 和插件示例。([GitHub][5])

但是我不建议作为主底座，因为：

**WPF / Windows-only 倾向太强。**

另外代码虽然 Apache-2.0，但内置动画素材有额外商业和分发条件。([GitHub][6])

所以 VPet 最适合我们研究：

> **桌面宠物应该有哪些行为和 lifecycle。**

而不是 fork 它。

---

# 7. Shimeji 也应该研究，但只是行为参考

新版 Shimeji fork 现在已经有人更新到 JDK 25，并支持 Windows/macOS/Linux。

它的核心思想几十年来一直非常正确：

```text
Action
Behaviour
Animation
```

全部通过 XML 描述。

于是角色可以：

```text
walk
climb
fall
sit
drag
jump
chase
```

而不需要修改程序。([GitHub][7])

这个设计很适合我们借鉴成：

```text
Brain Action
      ↓
Behavior
      ↓
Avatar Animation
```

但 Java/Shimeji 的历史包袱比较重，所以也不 fork。

---

# 8. 因此整个系统可以确定为四个现成来源

这是我现在推荐的最终组合：

| 子系统                   | 来源                     | 怎么用                  |
| --------------------- | ---------------------- | -------------------- |
| Desktop runtime       | **NyaDeskPet**         | fork                 |
| Avatar package        | **TonyNa desktop-pet** | 借格式                  |
| Brain runtime         | **fly.ai / flybrain**  | 直接 Python dependency |
| Brain visualizer      | **Jhongdlp/FlyBrain**  | 提取 Three.js viewer   |
| Desktop life behavior | VPet + Shimeji         | 借鉴，不依赖               |
| Future trainable SNN  | **BrainTrace**         | 第二阶段接入               |

这已经把自己需要开发的代码压得很少了。

---

# 9. 第一阶段：明确“不训练”

V0 应该非常克制。

完整系统：

```text
             NyaDeskPet
        Electron Desktop App
                 │
      ┌──────────┴──────────┐
      │                     │
 Avatar Runtime       Desktop Sensors
      │                     │
      │                 mouse move
      │                 mouse click
      │                 drag
      │                 idle
      │                 time
      │                 virtual object
      │                     │
      │                     ↓
      │              Sensory Encoder
      │                     │
      │              WebSocket / IPC
      │                     │
      │                     ↓
      │              Python Brain Service
      │                     │
      │                   fly.ai
      │              MaleCNS 166,700
      │                     │
      │             Descending Neurons
      │                     │
      │              Action Decoder
      │                     │
      └─────────────────────┘
                 │
                 ▼
             Avatar Action
```

第一版甚至只需要 8 个 Action：

| Brain Action | Avatar     |
| ------------ | ---------- |
| IDLE         | idle       |
| MOVE_LEFT    | walk_left  |
| MOVE_RIGHT   | walk_right |
| APPROACH     | walk       |
| AVOID        | run        |
| LOOK         | look       |
| INTERACT     | touch/wave |
| REST         | sleep      |

完全不用训练。

---

# 10. 输入也先不要做截图视觉

这会大幅降低复杂度。

直接把桌面事件变成 semantic sensory input。

例如：

```text
mouse appears on left
        ↓
LC10a left stimulation

mouse rapidly approaches pet
        ↓
LC4 + LPLC2

pet clicked
        ↓
touch sensory neurons

object appears
        ↓
selected visual / olfactory channel
```

这正是 `fly.ai` 目前已经使用的方法：它自己也指出视觉输入现在主要直接注入 feature-detector neurons，而不是完整模拟整个眼睛。([GitHub][1])

所以我们完全可以沿用。

---

# 11. 输出第一版也不要训练

先用 biological DN mapping。

`fly.ai` 已经提供几个非常好用的例子：

```text
DNa02 → steering
DNp01 → escape
DNg100 → forward
MDN → backward
```

这些本身就在它的通用 Brain API 中。([GitHub][1])

我们只需要增加一个：

```text
ActionDecoder
```

例如：

```text
DNa02 L > R → MOVE_LEFT
DNa02 R > L → MOVE_RIGHT

DNp01 high → AVOID

DNg100 high → APPROACH / FORWARD

MDN high → BACK
```

第一版就能“活起来”。

---

# 12. 这里非常重要：Brain 必须作为独立 Backend

不要写：

```text
DesktopPet → fly.ai
```

而是：

```text
DesktopPet
     ↓
BrainBackend
     ↓
┌───────────────┬────────────────┐
│               │                │
FlyAIBackend BrainTraceBackend RandomBackend
```

接口只规定：

```text
reset()
step(sensory_input)
get_action()
get_activity()
save_state()
load_state()
```

这一步非常重要。

因为 **`fly.ai` 自己明确没有 plasticity**：

* point neurons；
* global parameters；
* 没有 neuromodulator；
* 没有 plasticity。([GitHub][1])

所以不能把产品架构绑死到它。

---

# 13. 第二阶段不要直接上 whole-brain training

我建议训练分成三级。

### Stage 2A：先训练 Readout

这个 `fly.ai` 已经全部做好了。

```text
sensory input
     ↓
Frozen connectome
     ↓
DN neural traces
     ↓
PCA
     ↓
Ridge / Logistic Readout
```

它已经有：

```text
Readout.fit(...)
Trace(...)
run(...)
```

([GitHub][1])

这意味着第一种“学习”几乎零开发。

例如收集：

```text
mouse left → 希望它靠近
mouse near quickly → 希望它逃走
```

然后训练 decoder。

这时候：

> 大脑不变，只训练 interpretation。

---

# 14. Stage 2B：局部 biological plasticity

然后可以从 `Jhongdlp/FlyBrain` 借：

```text
PAM
PPL1
KC → MBON
```

它目前已经实现/测试 dopaminergic KC→MBON plasticity。([GitHub][2])

于是我们可以先研究真正果蝇比较熟悉的：

```text
object A
   ↓
sensory signal
   ↓
MB
   ↓
reward / punishment
   ↓
以后更靠近 / 更回避
```

这个比全脑训练容易得多。

---

# 15. Stage 2C 才进入 BrainTrace

BrainTrace 是我们最终“改变 brain”的路线。

它已经证明能以低内存 online-learning 方法训练 whole-brain-scale Drosophila SNN；官方的 whole-brain fitting 项目已经提供 checkpoint、训练循环、JAX/BrainState 实现，并实际训练 FlyWire connectome。([GitHub][8])

但现在它做的是：

```text
connectome
↓
训练
↓
拟合真实 brain activity
```

我们将来要改造成：

```text
desktop sensory stream
        ↓
MaleCNS / FlyWire SNN
        ↓
Action
        ↓
reward
        ↓
BrainTrace
```

这不是现成项目里的“一键功能”。

所以它应该是第二阶段研究，不应该阻挡 V0 上线。

---

# 16. 第一次上线甚至可以非常小

我会定义 V0 产品只有：

```text
Desktop Pet
+
1 个默认 Sprite 人形角色
+
fly.ai MaleCNS
+
8 sensory events
+
8 actions
+
Brain Lab
```

Brain Lab 则直接借 FlyBrain 的 viewer 思路：

```text
┌──────────────────────────────────────┐
│ Desktop Pet         Brain Viewer     │
│                                      │
│    🤖                 •••••••        │
│                        •••••         │
├──────────────────────────────────────┤
│ Sensory            Descending neuron │
│ mouse-left ████    DNa02-L ██████    │
│ looming    ██      DNp01   ██        │
│ touch      █       MDN     █         │
└──────────────────────────────────────┘
```

这已经足够验证最核心的问题：

> **完整 connectome 能不能成为一个有持续状态、对桌面刺激产生不同反应的“生命核心”。**

---

# 17. 最终工程结构我建议直接这样定

```text
flypet/
│
├── desktop/                 # fork NyaDeskPet
│   ├── renderer/
│   ├── avatar/
│   │   ├── sprite/
│   │   ├── live2d/
│   │   └── avatar.json
│   └── brain-lab/
│
├── brain-service/           # Python
│   ├── backend.py
│   │
│   ├── backends/
│   │   ├── flyai.py         ← 第一阶段
│   │   ├── braintrace.py    ← 第二阶段
│   │   └── mock.py
│   │
│   ├── sensory/
│   ├── decoder/
│   └── telemetry/
│
├── training/
│   ├── datasets/
│   ├── reservoir/
│   ├── plasticity/
│   └── braintrace/
│
└── simulator/               # 后面再做
    └── headless-world/
```

这样之后完全不会推倒重来。

---

## 我的最终选择

**主产品底座：`NyaDeskPet`。**

**大脑底座：`fly.ai / flybrain`。**

**可视化：抽 `Jhongdlp/FlyBrain` 的 Three.js connectome viewer 思路/代码。**

**Avatar：采用 `TonyNa desktop-pet` 那种 `character.json + sprite` 包格式，同时保留 Live2D Provider。**

**第一阶段：Frozen MaleCNS + 手工 encoder/decoder，完全不训练。**

**第一种训练：直接使用 `fly.ai` 已有 reservoir readout。**

**真正大脑训练：再引入 BrainTrace；局部奖励学习可以先借 FlyBrain 的 PAM/PPL1 → KC/MBON plasticity。**

这条路线的最大优点是：**第一版几乎全是拼现有项目；而第二阶段训练不是重构产品，只是新增 `BrainBackend`。**

我认为现在可以停止继续扩散选型，下一步应该直接进入 **V0 的模块边界和接口设计**：具体定义 `SensoryEvent`、`BrainAction`、`AvatarAction`、WebSocket 消息以及第一批映射到哪些 MaleCNS 神经元。

[1]: https://github.com/alextitonis/fly.ai "GitHub - alextitonis/fly.ai · GitHub"
[2]: https://github.com/Jhongdlp/FlyBrain "GitHub - Jhongdlp/FlyBrain: A video game boss driven by the biological connectome of Drosophila melanogaster (~165k neurons, MaleCNS v1.0). Deterministic Rust engine, vectorized Python VecEnv (>1M steps/s), Three.js 3D web visualizer. · GitHub"
[3]: https://github.com/gameswu/NyaDeskPet "GitHub - gameswu/NyaDeskPet: A desktop pet application based on Live2D and AI Agent · GitHub"
[4]: https://github.com/TonyNa-code/desktop-pet/ "GitHub - TonyNa-code/desktop-pet: A cross-platform anime desktop pet with character packs, chat, TTS, and multilingual UI. · GitHub"
[5]: https://github.com/LorisYounger/VPet/blob/main/README_en.md?utm_source=chatgpt.com "VPet/README_en.md at main · LorisYounger/VPet · GitHub"
[6]: https://github.com/LorisYounger/VPet?utm_source=chatgpt.com "GitHub - LorisYounger/VPet: 虚拟桌宠模拟器 一个开源的桌宠软件, 可以内置到任何WPF应用程序 · GitHub"
[7]: https://github.com/DalekCraft2/Shimeji-Desktop/blob/main/README.md?utm_source=chatgpt.com "Shimeji-Desktop/README.md at main · DalekCraft2/Shimeji-Desktop · GitHub"
[8]: https://github.com/chaobrain/braintrace?utm_source=chatgpt.com "GitHub - chaobrain/braintrace: Eligibility trace-based online learning for brain dynamics · GitHub"

