# 小手机酒馆助手脚本

导入文件：`酒馆助手脚本-小手机.json`

脚本入口：

```js
import 'https://testingcf.jsdelivr.net/gh/huanghuayu123/duanxinxiaoshouji@main/dist/tavern-phone-script/index.js?v=v1.0.7'
```

## v1.0.7

- 新增“读取过去聊天记录”按钮，可从当前酒馆聊天中读取已有 `<短信>...</短信>` 内容到小手机。
- 读取时会跳过已经同步过的同一段短信，减少重复导入。
- 保留 v1.0.6 的悬浮窗开关、拖动、编辑、删除和发送包裹 `<短信>` 功能。
