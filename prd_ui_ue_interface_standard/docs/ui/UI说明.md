# Anthopia App（移动端）UI 说明

> 适用端：Android / iOS。设计稿本体在 Figma，本文放可校验的文字说明。
> 页面清单与 `docs/prd/PRD.md` 第 4 节一致；跳转参数名与 `docs/数据字典.csv` 的字段英文名一致。

---

## 1. 设计稿链接 → R-UI-015

- Figma：由设计团队提供，本文件交付时尚未挂载（本文的 Token 表与状态清单已可独立评审）
- 版本 / 最后更新：v1.0 / 2026-10-22
- 画板命名：`页面名 / 状态`，例如 `任务市场页 / 加载`

---

## 2. 设计 Token → R-UI-001 / R-UI-002

Token 为语义化命名，可直接映射为移动端主题变量。产品为深色优先，浅色为同期出稿的对照主题。

### 颜色

| Token | 浅色值 | 深色值 | 用途 |
|---|---|---|---|
| `--color-primary` | `#7c3bff` | `#a070ff` | 主按钮、选中态、链接 |
| `--color-primary-dark` | `#6b2ee5` | `#8b5cf6` | 主按钮按下态 |
| `--color-primary-light` | `#7c3bff1a` | `#a070ff1a` | 主色浅底、标签背景 |
| `--color-bg-base` | `#ffffff` | `#000000` | 页面底色 |
| `--color-bg-primary` | `#f7f7f7` | `#141414` | 卡片背景 |
| `--color-bg-secondary` | `#f2f2f2` | `#000000` | 分组背景 |
| `--color-bg-tertiary` | `#00000008` | `#ffffff0a` | 输入框背景、分隔底 |
| `--color-bg-hover` | `#00000014` | `#ffffff33` | 列表项按下态背景 |
| `--color-text-primary` | `#000000` | `#ffffff` | 主文本 |
| `--color-text-secondary` | `#00000099` | `#ffffff99` | 次要文本 |
| `--color-text-tertiary` | `#00000066` | `#ffffff66` | 辅助文本、占位符 |
| `--color-text-tips` | `#0000004d` | `#ffffff4d` | 极弱提示文本 |
| `--color-border` | `#0000000f` | `#ffffff14` | 分隔线 |
| `--color-border-strong` | `#00000033` | `#ffffff1f` | 输入框边框 |
| `--color-success` | `#2bc235` | `#2bc235` | 成功、入账金额 |
| `--color-warning` | `#ffae6b` | `#ffae6b` | 警示、待处理角标 |
| `--color-danger` | `#f7594b` | `#f7594b` | 错误、危险按钮、支出金额 |
| `--color-info` | `#1a77ff` | `#1a77ff` | 信息、进行中状态 |
| `--color-muted` | `#909cb2` | `#909cb2` | 禁用文本、已完成状态 |

### 字号 / 字重 / 行高

| Token | 值 | 用途 |
|---|---|---|
| `--text-display` | 28px / 600 / 36px | 首页问候语 |
| `--text-title-lg` | 22px / 600 / 30px | 页面主标题 |
| `--text-title-md` | 18px / 600 / 26px | 卡片标题 |
| `--text-body-md` | 14px / 400 / 22px | 正文 |
| `--text-body-sm` | 13px / 400 / 20px | 次要正文 |
| `--text-caption` | 11px / 400 / 16px | 标签、时间戳 |
| `--text-number-lg` | 26px / 700 / 32px | 积分余额数值 |
| `--text-number-md` | 16px / 600 / 24px | 金额、计数 |

### 间距（4 基准刻度）

| Token | 值 | Token | 值 |
|---|---|---|---|
| `--space-1` | 4px | `--space-5` | 20px |
| `--space-2` | 8px | `--space-6` | 24px |
| `--space-3` | 12px | `--space-8` | 32px |
| `--space-4` | 16px | `--space-10` | 40px |

页面左右安全边距统一 `--space-4`；列表项纵向内边距 `--space-3`；标签栏高度 `--space-14`（56px）。

### 圆角 / 阴影 / z-index / 动效时长

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 标签、角标 |
| `--radius-md` | 10px | 按钮、输入框 |
| `--radius-lg` | 16px | 卡片 |
| `--radius-full` | 999px | 头像、胶囊按钮 |
| `--shadow-sm` | `0 2px 8px rgba(15,23,42,.08)` | 卡片 |
| `--shadow-md` | `0 8px 24px rgba(15,23,42,.12)` | 底部抽屉 |
| `--shadow-lg` | `0 16px 48px rgba(15,23,42,.18)` | 模态弹窗 |
| `--z-tabbar` | 100 | 底部标签栏 |
| `--z-drawer` | 500 | 底部抽屉 |
| `--z-modal` | 1000 | 模态弹窗 |
| `--z-toast` | 2000 | 全局提示 |
| `--duration-fast` | 120ms | 按钮按下 |
| `--duration-base` | 200ms | 抽屉、弹窗进出 |
| `--duration-slow` | 320ms | 页面转场 |

---

## 3. 页面状态清单 → R-UI-003 / R-UI-012 / R-UI-013

**加载态统一约定**：列表类页面一律用骨架屏；表单提交类一律用按钮内 spinner。两者不混用。

**空态约定**：与 PRD 第 4 节的「首次为空」与「筛选后为空」一一对应，两种空态使用不同画板。

| 页面 | 默认 | 加载（骨架屏） | 空（首次） | 空（筛选后） | 错误 | 无网络 | 无权限 | 极端数据 |
|---|---|---|---|---|---|---|---|---|
| 登录页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 注册页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 找回密码页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 首页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 通知中心 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 任务市场页 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| 任务详情页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 创建与编辑任务页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 任务协作页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 智能体列表页 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| 智能体详情页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 广场页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 话题详情页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | 不适用 | ☑ |
| 发布话题页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 等级总览页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 等级规则页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 凭证列表页 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| 凭证详情页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 钱包概览页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 流水列表页 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| 流水详情页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 个人中心页 | ☑ | ☑ | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 资料编辑页 | ☑ | ☑ spinner | ☑ | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 设置页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |
| 账号安全页 | ☑ | ☑ | 不适用 | 不适用 | ☑ | ☑ | ☑ | ☑ |

**极端数据画板明细**：

| 页面 | 极端数据画板内容 |
|---|---|
| 首页 | 未读角标「99+」；nickname 超过 8 字截断 |
| 任务市场页 | title 折行 2 行；bountyAmount 按「万」缩写 |
| 任务详情页 | description 折行 8 行 + 「展开全部」；deliverables 超过 20 件内部滚动 |
| 任务协作页 | content 2000 字满格气泡；消息总数 999+ 分页 |
| 广场页 | topicTitle 折行 2 行；likeCount「9999+」 |
| 话题详情页 | topicContent 折行 30 行 + 「展开全部」 |
| 凭证列表页 | credentialNo 单行省略；txHash 中间省略 |
| 凭证详情页 | txHash 超 40 字符分两行 + 复制按钮 |
| 钱包概览页 | atTokenBalance 超过 10 位按「万」缩写 |
| 流水列表页 | txAmount 按「万」缩写 |

---

## 4. 响应式与断点 → R-UI-004 / R-UI-014

| 断点 | 宽度（逻辑像素） | 布局 | 关键变化 |
|---|---|---|---|
| 手机竖屏 | 375 至 430 | 单列 | 底部标签栏常驻；列表单列；抽屉为底部抽屉 |
| 手机横屏 | 667 至 932 | 单列居中 | 内容最大宽度 480，两侧留白；标签栏保持底部 |
| 折叠屏展开 | 600 至 840 | 双列 | 首页与列表页双列瀑布；任务详情左右分栏（概览在左、对话在右） |
| 平板 | 768 及以上 | 双列 | 内容最大宽度 720；抽屉改为居中弹窗 |

**表格窄屏策略**：变卡片列表（不使用横向滚动）。凭证、流水、任务三类列表在全部断点均以卡片呈现。

**弹窗形态**：手机竖屏与横屏一律为底部抽屉；折叠屏展开与平板一律为居中弹窗。

**安全区**：底部标签栏与底部固定按钮需避让 iOS 安全区，底部内边距不小于 34px。

---

## 5. 交互态 → R-UI-005

触屏无 hover 概念，Android 与 iOS 一律以按下态替代 hover；接入外接键盘时保留聚焦态。

| 元素 | 默认 | 按下 | 聚焦（外接键盘） | 禁用 |
|---|---|---|---|---|
| 主按钮 | `--color-primary` 底 + 白字 | `--color-primary-dark` 底 | 2px `--color-primary` 外发光 | 40% 透明度，不可点 |
| 次按钮 | 透明底 + `--color-border-strong` 描边 | `--color-bg-hover` 底 | 2px 外发光 | 40% 透明度，不可点 |
| 文字链接 | `--color-primary` 字 | 60% 透明度 | 下划线 + 外发光 | `--color-muted` 字 |
| 列表项 | `--color-bg-primary` 底 | `--color-bg-hover` 底 | 2px 外发光 | 不适用 |
| 输入框 | `--color-bg-tertiary` 底 + 1px 描边 | 描边变 `--color-primary` | 描边 2px `--color-primary` | 40% 透明度 |
| 图标按钮 | 20% 透明度图标 | 60% 透明度图标 | 外发光 | 12% 透明度图标 |
| 标签（筛选） | 描边 + `--color-text-secondary` | `--color-bg-hover` 底 | 外发光 | 不适用 |
| 标签（选中） | `--color-primary-light` 底 + `--color-primary` 字 | 加深一档 | 外发光 | 不适用 |
| 点赞／关注 | 未选中描边图标 | 缩放到 0.92 并回弹 | 外发光 | 不适用 |

---

## 6. 跳转映射 → R-UI-006

参数名与 `docs/数据字典.csv` 字段英文名一致；路由与 `docs/ue/UE说明.md` 的路由表一致。

| 元素 | 所在页面 | 目标路由 | 参数 | 方式 |
|---|---|---|---|---|
| 「登录」按钮 | 登录页 | `/home` | — | 替换当前页 |
| 「创建账号」按钮 | 注册页 | `/home` | — | 替换当前页 |
| 「忘记密码？」 | 登录页 | `/reset-password` | — | 新页 |
| 铃铛图标 | 首页 | `/notifications` | — | 新页 |
| 通知项 | 通知中心 | `/task/detail/:taskId` | `taskId` | 新页 |
| 任务卡片 | 任务市场页 | `/task/detail/:taskId` | `taskId` | 新页 |
| 「创建任务」 | 任务市场页 | `/task/create` | — | 新页 |
| 「编辑任务」 | 任务详情页 | `/task/edit/:taskId` | `taskId` | 新页 |
| 「对话」分段 | 任务详情页 | `/task/collab/:taskId` | `taskId` | 本页切换 |
| 「指派智能体」 | 任务详情页 | `/agent/list` | `taskId` | 新页 |
| 智能体卡片 | 智能体列表页 | `/agent/detail/:agentId` | `agentId`、`taskId` | 新页 |
| 「指派到任务」 | 智能体详情页 | 返回来源任务详情 | `taskId`、`agentId` | 返回 |
| 话题卡片 | 广场页 | `/plaza/topic/:topicId` | `topicId` | 新页 |
| 「发布话题」 | 广场页 | `/plaza/create` | — | 新页 |
| 「等级」入口 | 个人中心页 | `/level` | — | 新页 |
| 「查看等级规则」 | 等级总览页 | `/level/rules` | — | 新页 |
| 「链上凭证」入口 | 个人中心页 | `/credential/list` | — | 新页 |
| 凭证卡片 | 凭证列表页 | `/credential/detail/:credentialId` | `credentialId` | 新页 |
| 「钱包」入口 | 个人中心页 | `/wallet` | — | 新页 |
| 「全部流水」 | 钱包概览页 | `/wallet/transactions` | — | 新页 |
| 流水项 | 流水列表页 | `/wallet/transaction/:txId` | `txId` | 新页 |
| 「查看关联任务」 | 流水详情页 | `/task/detail/:taskId` | `taskId`（取自 txRelatedTaskId） | 新页 |
| 「编辑资料」 | 个人中心页 | `/profile/edit` | — | 新页（底部抽屉） |
| 「通知中心」入口 | 个人中心页 | `/notifications` | — | 新页 |
| 「账号安全」入口 | 设置页 | `/settings/security` | — | 新页 |
| 底部标签：任务市场 | 全部主页面 | `/task/market` | — | 切换标签 |
| 底部标签：智能体 | 全部主页面 | `/agent/list` | — | 切换标签 |
| 底部标签：广场 | 全部主页面 | `/plaza` | — | 切换标签 |
| 底部标签：我的 | 全部主页面 | `/profile` | — | 切换标签 |

---

## 7. 组件命名 → R-UI-007

组件名与代码组件名一一对应，均采用大驼峰。

| 组件名 | 用途 | 状态入参 |
|---|---|---|
| `TaskCard` | 任务市场与我的任务卡片 | `task`、`onPress` |
| `AgentCard` | 智能体卡片 | `agent`、`onPress` |
| `PlazaTopicCard` | 广场话题卡片 | `topic`、`onPress` |
| `CredentialCard` | 凭证卡片 | `credential`、`onPress` |
| `TransactionRow` | 流水行 | `transaction`、`onPress` |
| `LevelBadge` | 等级徽章 | `levelCode`、`levelName` |
| `StatusChip` | 状态标签 | `status` |
| `TagPicker` | 筛选标签组 | `options`、`value`、`onChange` |
| `SegmentedTabs` | 任务详情分段切换 | `tabs`、`value`、`onChange` |
| `BottomSheet` | 底部抽屉 | `visible`、`onClose` |
| `ConfirmDialog` | 二次确认弹窗 | `title`、`message`、`onConfirm` |
| `EmptyState` | 空态 | `illustration`、`title`、`actionText` |
| `ErrorState` | 错误态 | `message`、`onRetry` |
| `SkeletonList` | 骨架屏列表 | `count`、`variant` |
| `ToastHost` | 全局提示宿主 | — |

## 8. 图标资源 → R-UI-008

- 格式：SVG，导出前合并为单色路径，颜色由 `currentColor` 控制。
- 命名：`ic_<模块>_<动作>.svg`，全小写，下划线分隔，例如 `ic_task_filter.svg`、`ic_wallet_arrow.svg`。
- 尺寸：24×24 为基准，导出三档 16 / 24 / 32，按 1 倍图导出，运行时按需缩放。
- 标签栏图标需提供选中与未选中两版，命名后缀分别为 `_on` 与 `_off`。

## 9. 暗色模式与多语言 → R-UI-009 / R-UI-010

- 暗色模式：同期出稿。第 2 节的颜色 Token 已给出浅色与深色两组值；切换跟随系统，用户可在设置页覆盖。
- 多语言：同期出稿 zh-CN 与 en-US。英文文案在相同画板中并列出稿，按钮宽度按英文最长值预留，中文 4 字按钮在英文下允许折行。

## 10. 标注可提取 → R-UI-011

- 所有画板开启 Figma 布局网格（4px）与自动布局，间距可直接读取，不依赖人工量取。
- 颜色一律引用本文第 2 节的 Token 变量，不在画板中直接填色值。
- 文字样式统一挂载本文的字号 Token，不单独设置字号。
