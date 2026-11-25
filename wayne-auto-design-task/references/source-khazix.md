# Source rationale and Wayne intent

## Article source

- **Title:** 毫无保留地分享一下，我是如何让Claude、GPT和Gemini完美协同的。
- **Author:** 数字生命卡兹克 (`Khazix0918`)
- **URL:** https://x.com/Khazix0918/status/2124680457623425334
- **Date:** 2026-11-23

### Independent big-plan proposal (lines 66–73)

> 第一步自然是理解需求做规划方案。需求也分为大需求和小需求，那很多的小需求Claude自己就直接干了，非常简单，但是如果是大方案、大规划，比如架构怎么定、数据怎么存、要不要长期绑定某个服务、一个系统下一步整体怎么改，我都会让Claude出一份，Gemini也独立出一份。
> 注意，是独立，给Gemini的，应该是我的原话和必要的背景，而不是Claude自己的草稿。
> Claude调用Gemini也非常简单，我在CLAUDE.md里加了一句就够了：
> “大方案自己出一份，同时用 agy-ask <目录> "任``务" 让 Gemini 独立出一份，放后台跑；只给它卡兹克的原话和必要背景，不给自己的草稿和倾向。小事自己想清楚就做。” agy-ask是我自己定义的一个只有90行的小脚本，主要是定到底用啥模型，禁止动文件只能查啥的，以及回答的规范等等，预设好了，方便Claude去调用Gemini。
> 所以两边同时出完方案以后，Gemini会把自己的方案给Claude，然后Claude会验证Gemini说的哪些是正确的哪些是不对的，然后跟自己的合并，给我一份最终方案，这样的方案完整性更高。
> 在我过去半个月的实践中，Gemini这个模型的思考维度跟Claude确实不太一样，两份独立的方案放在一起，几乎每次都会有对方没想到的地方，非常的互补，非常有意思。
> 我觉得没啥问题，就会拍个板，然后开始执行了。

Maps to: Boundary, Node C (Draft two independent proposals), Node D (Verify and fuse), and Node G (sign-off gate).

### Gemini as the copy and interaction consultant (lines 77–90)

> 但前端设计，不止是UI设计，光好看也是没用的，还有文案和交互。
> 这两块Claude和GPT有一样的问题，不写人话，并且喜欢写贼多解释性的字。
>
> AIHOT大模型排行榜这块的解释性文案这个就是之前Claude Opus 5.5做的，就是典型，太多了，我后来是懒得删了。。。
> 而且写的文案，也怪怪的，比如说我自己最近在做一个新的Agent调度层的产品（其实就是为了解决今天这篇文章的多模型调度问题和使用体验的）。
> 比如这个空状态页，它的文案是这么写的：“选中对话里的一段话，点「侧边问」，就能在这儿顺便问一句，不打断它正在做的事。”
>
> 这要是我们以前做交互设计，敢写这样的文案，是会被leader给摁在地上锤的。
> 相比之下，Gemini的就会好很多，这个修改的对照就能看出来。
>
> 所以，我现在还会让Gemini当文案和交互的顾问。
> 同样的，也是在CLAUDE.md里加了一条：
> “前端、视觉、拆解和验收自己做。界面文案和交互自己先做一版，再用 agy-ask 请 Gemini 当顾问改一遍：给它这一页是给谁用的、要让人做成什么、现在的文案和交互；它的修改由你对照功能实际怎么用核实后采纳。只改几个字的不用。”
> 这样就会很舒服了，而且Gemini提出的文案和交互意见，Claude几乎大部分都是全部采纳了，除非是遇到一些比较专业性的文案，然后Gemini开始犯病瞎编或者瞎给承诺...

Maps to: Node R (Gemini interaction and copy review).

### CLAUDE.md 派活 rules (lines 166, 170–171)

> - 只把接口已经定死、和页面无关的独立模块（成块的后端、算法、数据处理、性能）交给本机的 Codex 写，你定接口和验收标准。修改、修审查发现、几十行的改动、要和页面来回对接口的功能自己做。用 `codex-worker` 固定的档位。前端、视觉、拆解和验收自己做。界面文案和交互自己先做一版，再用 `agy-ask --copy <目录> "任务"` 请 Gemini 当顾问改一遍：给它这一页是给谁用的、要让人做成什么、现在的文案和交互；它的修改由你对照功能实际怎么用核实后采纳。只改几个字的不用。

Maps to: Node P (Implementation plan, parallel build) and Node R (Gemini interaction and copy review).

> - 大方案自己出一份，同时用 `agy-ask <目录> "任务"` 让 Gemini 独立出一份，放后台跑；只给它卡兹克的原话和必要背景，不给自己的草稿和倾向。小事自己想清楚就做。
> - 两份由你合并：有分歧以代码和线上数据为准，它标“推测”的先核实；合成一份给他，写明两份一致的、采纳了 Gemini 的、不采纳的和理由；两边都有道理、定不下来的原样摆给他拍板。

Maps to: Node C (Draft two independent proposals), Node D (Verify and fuse), and Node G (undecidable rows).

### When to ask him (lines 128–129)

> - 他的精力最宝贵，只在这几种情况找他：先问清单里的动作；新的视觉方向（整体风格或主视觉换方向时出两三版样稿让他挑，调配色、间距、修样式直接做）；查过代码、记录、线上状态和记忆仍定不了、又会改变结果的事。要问就先做完不依赖它的部分，再一次问清：要定什么、你推荐哪个、各选项的后果；能做出样子的先做给他看。
> - 先问清单：删数据、停服、花钱、对外发消息（他之外有人会收到的都算，包括给同事 OKR 的加油和 GitHub 等公开平台的评论）、改产品方向、新建或轮换密钥、修改权限。清单之外直接做。不算在内：发布时正常的重启和切换，已有服务按用量的费用（流量、付费接口、Agent 额度），给自己发布的应用设置谁能访问，使用已有的凭据、SSH 和权限，功能调整、交互优化和修复。他在对话里明确要你做的具体动作就是批准。

Maps to: Node G (Decide whether Wayne is needed) and Node Q (Ask one consolidated question).

## Wayne's own morning words (2026-11-25)

1. > "我要让 gemini 同步出方案， 然后主模型 来做对比 ， 融合，然后让 gemini 去审查交互和文案。 然后主模型推进实现"

   Maps to: Nodes C, D, R, and P.

2. > "主模型自己一个人的方案简直是 完全不管UX的合理性"

   Maps to: Nodes C and R.

3. > "在task delegation session 里临时我的feedback ， 他应该主模型plan 然后 subagent 直接干活"

   Maps to: Node P (main model writes the implementation plan and dispatches subagents directly).

4. > "lite plan 可以skip review 直接干活"

   Maps to: Node P (mid-session feedback uses a lite plan that skips review and dispatches parallel subagents directly).
