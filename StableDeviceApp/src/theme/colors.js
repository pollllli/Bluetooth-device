/**
 * PartLit 全局主题色彩常量
 * 遵循《PartLit VI 视觉设计手册 V1.0》（方案B · 轻盈收纳 · 智能可见）
 *
 * 品牌色板（VI 手册 Slide 7-8）：
 *   主色 薄荷绿 #6EE8B7  — Logo / CTA 按钮 / LED 指示 / 选中态
 *   辅色 青绿   #6EE8B7  — 辅助强调 / 成功状态 (与主色统一)
 *   文字 暖深灰 #37474F  — 正文与标题（禁用纯黑）
 *   点缀 暖橙   #FFAB40  — 少量强调，不超过 10%
 *
 * 使用禁令（VI 手册 Slide 8 / 20）：
 *   ✗ 不要使用蓝色（与产品实际 LED 冲突）
 *   ✗ 不要用黑色（用暖深灰 #37474F 替代）
 *   ✗ 暖橙不超过 10%，不作大面积背景
 *   ✗ 不超过 4 种主色同框
 *
 * 分层:
 *   bg       背景层（白/浅灰，呼吸感）
 *   surface  表面层 (卡片/列表/弹窗)
 *   border   边框/分割线
 *   text     文字（暖深灰系）
 *   accent   主色薄荷绿 (主交互)
 *   success  辅色青绿 (成功/存入/已连接)
 *   danger   危险/删除/缺货
 *   warning  点缀暖橙 (警告/待处理)
 */

const colors = {
  // ========== 背景（白/浅灰为主，营造呼吸感）==========
  bg: '#EDF1F2',              // 全局背景: 中性冷灰 (#EDF1F2), 衬托品牌主色 #6EE8B7 形成"灰底+绿点缀"对比
  bgSecondary: '#EDF1F2',     // 表面层: 卡片/列表项/弹窗 (与页面背景同色, 统一大色块)
  bgElevated: '#DDE2E4',      // 表面升层: 输入框/搜索框 (比页面背景深一档的同色系冷灰, 凹槽可辨)
  bgOverlay: 'rgba(15,23,42,0.5)', // 遮罩层

  // ========== 边框 ==========
  border: '#E0E4E8',         // 卡片边框/分割线
  borderLight: '#EFF2F5',    // 细分割线
  shadow: '#37474F',         // 阴影色 (VI 禁纯黑，用暖深灰)

  // ========== 浮雕阴影等级（VI 新拟物效果 — 肉眼可见的上浮/下凹）==========
  elevationLight: 'rgba(55,71,79,0.08)',   // 轻微浮雕 (小卡片/标签)
  elevationMedium: 'rgba(55,71,79,0.14)',  // 中等浮雕 (普通卡片/按钮)
  elevationHeavy: 'rgba(55,71,79,0.22)',   // 强浮雕 (FAB/重点按钮)

  // 内凹边缘（Neumorphism inset — 搜索框/输入框凹陷感）
  insetEdge: 'rgba(55,71,79,0.30)',        // 内凹上/左边（深色软阴影，Android 加强）
  insetHighlight: 'rgba(255,255,255,1.0)', // 内凹下/右高光（浅，不透明）
  projectionLine: 'rgba(55,71,79,0.12)',   // 顶部方向性投影线（Android 悬浮感）

  // 外凸边缘（Neumorphism raised — 底部导航/卡片悬浮感）
  // 光源统一来自左上: 左下深色软投影 + 右上亮色高光
  raisedShadow: 'rgba(55,71,79,0.22)',     // 外凸落影 (左下方向, 中等模糊)
  raisedHighlight: 'rgba(255,255,255,0.95)', // 外凸受光棱 (右上方向, 低模糊)

  // ========== 文字 ==========
  textPrimary: '#37474F',    // 主文字 (VI 暖深灰)
  textSecondary: '#90A4AE',  // 辅助文字/占位符 (VI 蓝灰)
  textMuted: '#B0BEC5',      // 禁用态/不可交互文字
  textInverse: '#FFFFFF',    // 彩色按钮上的白色文字

  // ========== 交互色 ==========
  accent: '#6EE8B7',         // 主色: 薄荷绿 (VI 主色) 按钮/链接/FAB/选中/LED
  accentHover: '#4ED8A0',    // 主色悬停态 (深一档)
  accentBg: 'rgba(110,232,183,0.10)', // 主色背景 (选中行/高亮区域)
  ledColor: '#6EE8B7',       // 亮灯 LED 色（老大指定，亮薄荷绿）
  litColor: '#6EE8B7',        // 已点亮/已选中态 (与 ledColor 一致, BOM 列表点击已有器件时用)
  positionOccupied: '#60E4AD', // 位置已被占用 (浅一档青绿, 区分 ledColor 亮灯态)
  positionOccupiedText: '#FFFFFF', // 占用格文字 (白色, 强对比)

  // ========== 状态色 ==========
  success: '#6EE8B7',        // 辅色青绿: 成功/存入/已连接 (与主色绿统一)
  successBg: 'rgba(110,232,183,0.10)',
  teal: '#59C2AF',           // 已连接状态指示点 (蓝绿/teal, 与 success 同色系但更冷)
  danger: '#F9A947',         // 危险/删除/缺货/断开 (暖橙 #F9A947, 替代原 #E53935 红)
  dangerBg: 'rgba(249,169,71,0.10)',  // 浅暖橙背景 (替代原 rgba(229,57,53,0.10) 浅红)
  warning: '#FFAB40',        // 点缀暖橙 (VI 点缀色, ≤10%)
  warningBg: 'rgba(255,171,64,0.12)',

  // ========== 导航栏 ==========
  tabBar: '#FFFFFF',
  tabBarBorder: '#E0E4E8',
  tabFontColor: '#37474F',   // 底部导航字体色（与主文字 textPrimary 一致的暖深灰）
  tabActive: '#37474F',      // 激活色
  tabInactive: '#37474F',    // 未激活色

  headerBg: '#EDF1F2',         // 与全局页面背景色保持一致, 标题栏不再突兀白块 (统一大色块, 与 bg 同色)
  headerBorder: '#E0E4E8',
  headerText: '#37474F',     // 暖深灰
  headerTint: '#6EE8B7',     // 主色绿

  // ========== 图片查看器（沉浸黑底，功能性色，不计入主色系）==========
  viewerBg: 'rgba(0,0,0,0.92)',             // 全屏看图黑底
  viewerControlBg: 'rgba(255,255,255,0.18)', // 浮层按钮半透明白底
  viewerControlText: 'rgba(255,255,255,0.6)', // 浮层提示半透明白字
};

export default colors;
