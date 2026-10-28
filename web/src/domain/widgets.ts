/**
 * 原子控件目录 —— 来源：`platform/design/数据模型.md §4`（37 项，已随 `D-Q20` 冻结为基线）。
 * 分组名取自 `UI-Spec §4.8 ④`（10 类）。**每项 = 一个确定的 Android 类**，不得自造。
 *
 * ⚠️ 控件面板的筛选是**本地筛选，不走接口**（`UI-Spec §4.8` 交互表）。
 */

export type WidgetType =
  | "TEXT" | "MULTILINE_TEXT" | "RICH_TEXT" | "LABEL" | "BUTTON"
  | "INPUT" | "MULTILINE_INPUT" | "PASSWORD_INPUT" | "SEARCH_BOX"
  | "IMAGE" | "AVATAR" | "VIDEO"
  | "LINEAR_LAYOUT" | "CONSTRAINT_LAYOUT" | "RELATIVE_LAYOUT" | "SCROLL_VIEW" | "CARD"
  | "LIST" | "GRID" | "BANNER"
  | "RADIO_BUTTON" | "CHECK_BOX" | "RADIO_GROUP" | "CHECK_GROUP" | "SWITCH"
  | "SPINNER" | "SEEKBAR" | "RATING_BAR"
  | "DATE_PICKER" | "TIME_PICKER"
  | "PROGRESS_BAR" | "LOADING"
  | "TOOLBAR" | "BOTTOM_NAV" | "TAB_LAYOUT"
  | "DIVIDER" | "SPACE";

export interface WidgetDef {
  type: WidgetType;
  /** 展示名（面板上显示的文字） */
  label: string;
  /** Android 类（生成代码的目标） */
  android: string;
  /** 可作容器（能接收子控件） */
  container: boolean;
  group: string;
}

export const GROUPS = [
  "文本与按钮", "输入", "媒体", "容器与布局", "列表与网格",
  "选择", "时间", "进度与反馈", "导航", "其它",
] as const;

export const WIDGETS: WidgetDef[] = [
  { type: "TEXT", label: "文本", android: "TextView", container: false, group: "文本与按钮" },
  { type: "MULTILINE_TEXT", label: "多行文本", android: "TextView（多行）", container: false, group: "文本与按钮" },
  { type: "RICH_TEXT", label: "富文本", android: "TextView（Spannable）", container: false, group: "文本与按钮" },
  { type: "LABEL", label: "标签", android: "TextView（单行，窄内边距）", container: false, group: "文本与按钮" },
  { type: "BUTTON", label: "按钮", android: "Button", container: false, group: "文本与按钮" },

  { type: "INPUT", label: "输入框", android: "EditText", container: false, group: "输入" },
  { type: "MULTILINE_INPUT", label: "多行输入", android: "EditText（多行）", container: false, group: "输入" },
  { type: "PASSWORD_INPUT", label: "密码输入", android: "EditText（密码）", container: false, group: "输入" },
  { type: "SEARCH_BOX", label: "搜索框", android: "SearchView", container: false, group: "输入" },

  { type: "IMAGE", label: "图片", android: "ImageView", container: false, group: "媒体" },
  { type: "AVATAR", label: "头像", android: "ImageView（圆形裁剪）", container: false, group: "媒体" },
  { type: "VIDEO", label: "视频播放", android: "VideoView", container: false, group: "媒体" },

  { type: "LINEAR_LAYOUT", label: "线性容器", android: "LinearLayout", container: true, group: "容器与布局" },
  { type: "CONSTRAINT_LAYOUT", label: "约束容器", android: "ConstraintLayout", container: true, group: "容器与布局" },
  { type: "RELATIVE_LAYOUT", label: "相对容器", android: "RelativeLayout", container: true, group: "容器与布局" },
  { type: "SCROLL_VIEW", label: "滚动容器", android: "ScrollView（单子）", container: true, group: "容器与布局" },
  { type: "CARD", label: "卡片", android: "CardView", container: true, group: "容器与布局" },

  { type: "LIST", label: "列表", android: "RecyclerView", container: true, group: "列表与网格" },
  { type: "GRID", label: "网格", android: "GridView", container: true, group: "列表与网格" },
  { type: "BANNER", label: "轮播", android: "ViewPager2", container: true, group: "列表与网格" },

  { type: "RADIO_BUTTON", label: "单选按钮", android: "RadioButton", container: false, group: "选择" },
  { type: "CHECK_BOX", label: "多选按钮", android: "CheckBox", container: false, group: "选择" },
  { type: "RADIO_GROUP", label: "单选组", android: "RadioGroup", container: true, group: "选择" },
  { type: "CHECK_GROUP", label: "多选组", android: "LinearLayout（纵向 + 一组 CheckBox）", container: true, group: "选择" },
  { type: "SWITCH", label: "开关", android: "Switch", container: false, group: "选择" },
  { type: "SPINNER", label: "下拉选择", android: "Spinner", container: false, group: "选择" },
  { type: "SEEKBAR", label: "滑块", android: "SeekBar", container: false, group: "选择" },
  { type: "RATING_BAR", label: "评分", android: "RatingBar", container: false, group: "选择" },

  { type: "DATE_PICKER", label: "日期选择器", android: "DatePicker", container: false, group: "时间" },
  { type: "TIME_PICKER", label: "时间选择器", android: "TimePicker", container: false, group: "时间" },

  { type: "PROGRESS_BAR", label: "进度条", android: "ProgressBar（条形）", container: false, group: "进度与反馈" },
  { type: "LOADING", label: "加载中", android: "ProgressBar（圆形）", container: false, group: "进度与反馈" },

  { type: "TOOLBAR", label: "顶部标题栏", android: "Toolbar", container: true, group: "导航" },
  { type: "BOTTOM_NAV", label: "底部导航", android: "BottomNavigationView", container: false, group: "导航" },
  { type: "TAB_LAYOUT", label: "标签页", android: "TabLayout", container: true, group: "导航" },

  { type: "DIVIDER", label: "分割线", android: "View（1dp 高）", container: false, group: "其它" },
  { type: "SPACE", label: "占位", android: "Space", container: false, group: "其它" },
];

export const WIDGET_BY_TYPE = new Map(WIDGETS.map((w) => [w.type, w]));

/** 控件在画布上的默认尺寸（dp）—— 仅用于新建时的初始值，之后由属性面板控制 */
export const DEFAULT_SIZE: Partial<Record<WidgetType, { w: number | "wrap" | "match"; h: number | "wrap" | "match" }>> = {
  TEXT: { w: "match", h: 24 }, LABEL: { w: "wrap", h: 20 }, BUTTON: { w: 120, h: 40 },
  INPUT: { w: "match", h: 40 }, MULTILINE_INPUT: { w: "match", h: 88 }, PASSWORD_INPUT: { w: "match", h: 40 },
  SEARCH_BOX: { w: "match", h: 36 },
  IMAGE: { w: 160, h: 120 }, AVATAR: { w: 48, h: 48 }, VIDEO: { w: "match", h: 180 },
  LINEAR_LAYOUT: { w: "match", h: 120 }, CONSTRAINT_LAYOUT: { w: "match", h: 160 },
  RELATIVE_LAYOUT: { w: "match", h: 120 }, SCROLL_VIEW: { w: "match", h: 240 },
  CARD: { w: "match", h: 96 }, LIST: { w: "match", h: 200 }, GRID: { w: "match", h: 200 },
  BANNER: { w: "match", h: 140 },
  RADIO_BUTTON: { w: "wrap", h: 24 }, CHECK_BOX: { w: "wrap", h: 24 },
  RADIO_GROUP: { w: "match", h: 72 }, CHECK_GROUP: { w: "match", h: 72 },
  SWITCH: { w: "wrap", h: 24 }, SPINNER: { w: "match", h: 40 }, SEEKBAR: { w: "match", h: 32 },
  RATING_BAR: { w: "wrap", h: 28 }, DATE_PICKER: { w: "match", h: 160 }, TIME_PICKER: { w: "match", h: 120 },
  PROGRESS_BAR: { w: "match", h: 8 }, LOADING: { w: 40, h: 40 },
  TOOLBAR: { w: "match", h: 56 }, BOTTOM_NAV: { w: "match", h: 56 }, TAB_LAYOUT: { w: "match", h: 48 },
  DIVIDER: { w: "match", h: 1 }, SPACE: { w: "match", h: 16 },
};
