# AI Algorithm Case Builder

一个本地算法竞赛测试数据生成小工具：粘贴题面，AI 自动改 `makedata.cpp` 和 `std.cpp`，然后生成 `cases` 测试点。

配合 Hydro 平台使用效果极佳。

## 启动

双击：

```text
启动AI界面.command
```

## 使用流程

1. 打开界面后，粘贴或上传 Markdown 格式的题面。
2. 填入你的 API Key；如果是 NewAPI 配置 JSON，可以整段直接粘贴。
3. 工具会自动识别模型服务，并自动获取可用模型。
4. 点击“测试连接”，确认 API 可以正常使用。
5. 点击“生成代码并运行”。
6. 程序会直接修改原有的：
   ```text
   捏数据/makedata.cpp
   捏数据/std.cpp
   ```
7. 修改完成后会自动编译运行，把测试点放到：
   ```text
   捏数据/cases/
   ```
8. 把 `cases` 文件夹上传到 Hydro。
9. 如果需要标准程序，点击“复制 std.cpp”即可复制当前标准代码。

## 工作逻辑

这个工具不会凭空新建一套代码文件，而是读取现有的 `makedata.cpp` 和 `std.cpp`，让 AI 在原文件基础上修改。

生成测试点时，会先在临时位置生成完整数据，再发布到 `cases` 文件夹，避免上传时读到半成品。

## 目录

```text
捏数据/
├── makedata.cpp    # 数据生成器
├── std.cpp         # 标准程序
├── loop.sh         # macOS / Linux 手动生成脚本
├── loop.bat        # Windows 手动生成脚本
└── cases/          # 生成后的测试点
```

真实 API Key 不要提交到 GitHub。
