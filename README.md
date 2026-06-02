# 小手机酒馆助手脚本

导入文件：`酒馆助手脚本-小手机.json`

脚本入口：

```js
import 'https://testingcf.jsdelivr.net/gh/huanghuayu123/duanxinxiaoshouji@main/dist/tavern-phone-script/index.js?v=v1.0.5'
```

## v1.0.5

- 关闭重复拖动监听，只保留基础鼠标/触摸拖动，修复松手卡住。
- 拖动释放挂到窗口层，鼠标/手指移出元素后也能松开。
- 手机发送到酒馆时自动包裹为当前短信标签，默认 `<短信>内容</短信>`。
- 增强发送桥：手机内发送会写入酒馆输入框，并触发酒馆发送按钮。
- 悬浮窗和手机面板支持拖动。
