# 小手机酒馆助手脚本

导入文件：`酒馆助手脚本-小手机.json`

脚本入口：

```js
import 'https://testingcf.jsdelivr.net/gh/huanghuayu123/duanxinxiaoshouji@main/dist/tavern-phone-script/index.js?v=v1.0.4'
```

## v1.0.4

- 增加左下角“打开小手机”备用按钮。
- 增加 `Ctrl+Shift+M` 快捷键打开。
- 暴露 `openXiaoShouJi()` 到页面全局，方便控制台测试。
- 初始化拆成保护式，避免某一步失败导致入口完全不可用。
- 增强发送桥：手机内发送会写入酒馆输入框，并触发酒馆发送按钮。
- 悬浮窗和手机面板支持拖动。
