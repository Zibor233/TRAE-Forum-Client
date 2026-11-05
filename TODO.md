# TODO

## 已解决

### 信息流向下滚动时画面「闪一下」（2026-11-05 记录 / 2026-11-05 修复）

- **现象（原记录）**：发现页 / 分类信息流页向下滚动时画面短暂闪一下（视觉抖动），长列表、多种卡片高度下均可复现。
- **根因**（实测确认，两条叠加）
  1. `FeedCard` 的封面比例是运行时状态：初始 `4/3`，图片 `onLoad` 后按 `naturalWidth/naturalHeight` 改成真实比例（0.62–1.75）。每张封面解码完成都会让卡片高度跳变一次，4 列 CSS `columns` 瀑布流随之整列重排 → 视觉抖动。
  2. 瀑布流用 CSS `columns-2/3/4`，分页追加数据时浏览器会重新平衡各列，已渲染的卡片会跨列移动（每轮新增 30 条时尤其明显）。
  3. 图片只有 `loading="lazy"`，没有 `decoding`，占位色接近白色，滚动进入视口时有短暂空白感。
- **改动文件**
  - `src/components/FeedCard.tsx`：新增 `feedCardRatio()`（按话题 id 稳定取 4/3、1、3/4）、`feedCardTextHeight()`、`feedCardEstimate()`；删除 `ratio` state 与 `onLoad` 改比例逻辑，首次渲染即确定高度；封面占位改为 `bg-line/30` 色块；`img` 增加 `decoding="async"`（保留 `loading="lazy"`）。
  - `src/pages/FeedPage.tsx`：新增 `useColumnCount()`（2/3/4 列，与 md/lg 断点一致）与 `distributeColumns()`（按估算高度贪心分列），渲染改为 `flex` 列容器（`flex min-w-0 flex-1 flex-col gap-y-3.5`），翻页时新卡片只追加到最短列末尾，已有卡片不再跨列。
- **修复前后指标**
  | 指标 | 修复前 | 修复后 |
  |---|---|---|
  | 5 秒滚动 layoutShift 总分 | 0.3758 | 0（连续滚动无 shift 记录） |
  | 最长单次 shift | 0.1445 | 0 |
  | shift 条目数 | 6 | 0 |
  | 采样 32 帧内卡片跨列/高度跳变 | 有（封面解码导致 83px 级高度跳变） | 0 |
  | 无宽高的 `img` | 209 / 506 | 0（封面容器 `aspect-ratio` 固定） |
  | `decoding` | 全部 none | async |
- **追加策略（2026-11-05 补充）**：「往下排列，别往上推」
  - 视口锁定：`loadPage` 追加前 `captureAnchor()` 记录视口内首个卡片的 `top`，`useLayoutEffect` 在 `items.length` 变化后同帧比较，`delta > 0.5` 时 `window.scrollBy(0, delta)` 抵消。
  - 根容器加 `[overflow-anchor:none]`，关闭浏览器滚动锚定，避免与手动补偿打架。
  - 底部占位：列表末尾固定 56px（`h-14`）sentinel，加载中/非加载中都占位；触底改用 `IntersectionObserver`（`rootMargin: 0px 0px 1200px 0px`）观察 sentinel。
  - 分列仍为贪心最短列追加，新卡只进列尾，已渲染卡片 DOM 位置不变；已在底部时 `scrollTop` 保持不变，不自动吸底。
- **残留（非闪烁，已接受）**：把页面滚到**绝对底部**再触底加载时，页脚与 sentinel 位于插入点之下，必然被推离视口。实测每次追加 CLS ≈ `0.1678`（3 次合计 `0.5021`）；隐藏页脚后仅 sentinel 约 `0.0543`。用户正常滚动（未贴底）时为 0。要降到 `<0.02` 需把页脚/加载条改为 sticky/fixed 或自动吸底，与「保持 scrollTop 不变」诉求冲突，暂不采用。
- **复测方式**：CDP headless Chrome + `PerformanceObserver('layout-shift')`，1280×900 连续滚动 5 秒，逐帧对比可见卡片 `x/height`；桌面 4 列、390px 下 2 列，社区置顶横滑正常。
- **状态**：已修复，tsc 与 build 通过。
