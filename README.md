# 小手机酒馆助手脚本

导入文件：`酒馆助手脚本-小手机.json`

脚本入口：

```js
import 'https://testingcf.jsdelivr.net/gh/huanghuayu123/duanxinxiaoshouji@main/dist/tavern-phone-script/index.js?v=v1.0.2'
```

## v1.0.2

- 根层置顶但穿透事件，只有悬浮窗和面板接收点击。
- 拖动监听改为捕获阶段，减少被酒馆页面截获的情况。
- 点击悬浮窗增加捕获守护，点到就打开。
- 增强发送桥：手机内发送会写入酒馆输入框，并触发酒馆发送按钮。
- 悬浮窗和手机面板支持拖动。
