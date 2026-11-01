# 外观系统

- 更新：2026-11-01
- 依据：`deep-research-3`。原版设置页是 `apps/web/builtin/AppearanceSettingTab.ts`，应用是 `apps/web/app/theme/AppearanceManager.ts`。原生版只接了基础色和丝带。
- 这一页是决定，代码还没按它改。

第一版分两块。从原版搬回来的是已经能画出来的设置。从 Zed 接过来的，只接到 mygo 和 `attention-ui` 里已有的主题对象上。

## 从原版恢复

- 基础色保持 `system`、`moonstone`、`obsidian`，丝带开关保持。两者都已经写在 `appearance.json` 里。
- 强调色用原来的取色器，存成一个颜色，画主题时用上。不再写成文档上的 CSS 变量。
- 三套字体：界面、正文、等宽。基础字号限制在 10–30，默认 16。
- 两个界面开关：视图顶栏默认开，行内标题默认关。

## 从 Zed 接到现有对象

- 字体分三层：界面、编辑器、终端，各有字体和字号。回退字体等控件能表达再加。
- 编辑器行高用 1.618 和 1.3 两档，外加自定义比例。
- 主题可以是一个名字，或 `{mode, light, dark}`。选择时先预览再确定。图标主题同样分浅色和深色名字。
- 语法样式按主题改，例如注释斜体。现在编辑器没有设主题，语法色是写死的 GitHub 色。
- 文件树行距分 comfortable 和 standard。标签栏、文件类型图标、行号、滚动条可以单独开关。
- 间距、圆角、滚动条宽度接到 `ui.Theme`，不再写死 8、8、4。

## 第一版不做

- 社区 CSS 主题、主题目录、Manage、CSS 片段。它们往文档里注入样式表，原生窗口没有这条路径。
- 高级那一组：缩放、原生菜单、窗口边框、自定义图标、半透明、硬件加速。
- 丝带上具体放哪些动作。现在只有显示和隐藏。
- 不另做一套颜色 token 格式。`theme.For` 的方案名继续是 `"default"`，直到真有选择器写出别的值。

## 调研

- [Zed 的外观](research/appearance-zed.md)
- [原版 Appearance 和原生缺口](research/appearance-original.md)
- [Kero 2.1.25–2.1.31 的界面](research/appearance-kero.md)
