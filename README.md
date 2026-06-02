# 小手机酒馆助手脚本

导入文件：`酒馆助手脚本-小手机.json`

脚本入口：

```js
import 'https://testingcf.jsdelivr.net/gh/huanghuayu123/duanxinxiaoshouji@main/dist/tavern-phone-script/index.js?v=v1.0.3'
```

## v1.0.3

- 根层和入口增加内联层级/事件样式，减少被酒馆样式覆盖。
- 增加鼠标/触摸基础拖动备用，不依赖单一 pointer 事件。
- 初始化后会强制把悬浮窗显示并夹回屏幕内。
- 增强发送桥：手机内发送会写入酒馆输入框，并触发酒馆发送按钮。
- 悬浮窗和手机面板支持拖动。
