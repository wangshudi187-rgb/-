# AI 减脂进度追踪

一个无需后端的个人减脂追踪前端项目。支持每日早晨录入体重和围度，记录前一天运动与饮食执行情况，自动生成趋势图、减重拆解、目标进度和本地备份。体重单位统一使用“斤”。

项目内置简单访问密码和多用户切换，适合把测试数据与正式数据隔离。

## 文件结构

```text
project/
├── index.html
├── style.css
├── script.js
└── README.md
```

## 本地运行

直接用浏览器打开 `index.html` 即可。

默认访问密码：

```js
123456
```

登录成功后会用 `localStorage` 记录状态，刷新页面不会退出。

## 多用户系统

启动页面会先显示登录与用户选择界面：

- `test`：测试用数据
- `main`：正式记录用数据

进入系统后，顶部会显示当前用户下拉框。切换用户后，页面会自动重新读取该用户的数据、目标设置和图表，不同用户之间的数据互不影响。

## localStorage 数据结构

每个用户的数据使用独立 key 保存：

```text
user_test_data
user_main_data
```

每个 key 的值结构如下：

```json
{
  "user": "main",
  "data": [
    {
      "user": "main",
      "date": "2026-06-30",
      "activityDate": "2026-06-29",
      "weight": 150,
      "waist": 82,
      "steps": 9000,
      "cardio": 40,
      "trainingType": "Zone2",
      "dietControlled": "yes",
      "carbLevel": "中"
    }
  ]
}
```

体重字段名仍为 `weight`，但数值单位是“斤”。每个用户另有独立单位迁移标记：

```text
user_test_weight_unit_version
user_main_weight_unit_version
```

值为 `jin` 时表示该用户数据已按“斤”保存。

目标设置也按用户隔离：

```text
user_test_settings
user_main_settings
```

当前登录状态和当前用户分别保存在：

```text
ai-fat-loss-tracker-authenticated-v1
ai-fat-loss-tracker-current-user-v1
```

## 部署到 Vercel

1. 将 `project` 文件夹内的文件上传到 GitHub 仓库根目录。
2. 打开 Vercel，选择 `Add New Project`。
3. 导入该 GitHub 仓库。
4. Framework Preset 选择 `Other`。
5. Build Command 留空。
6. Output Directory 留空或填写 `.`。
7. 点击 Deploy。

如果仓库根目录外层还保留了 `project` 文件夹，请在 Vercel 的 Root Directory 里选择 `project`。

## 部署到 GitHub Pages

1. 将 `project` 文件夹内的文件放到 GitHub 仓库根目录。
2. 进入仓库 `Settings`。
3. 打开 `Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待 GitHub Pages 生成访问地址。

如果你想保留 `project` 文件夹作为子目录，也可以把 GitHub Pages 目录指向包含 `index.html` 的位置。

## 数据说明

- 所有记录默认保存在浏览器 `localStorage`。
- `test` 和 `main` 使用不同的 localStorage key，数据完全隔离。
- 可使用页面顶部的导出/导入功能迁移数据。
- 如果浏览器支持文件夹写入权限，可点击“选择备份文件夹”，之后每次保存都会额外创建一个新的 JSON 备份文件。
- 备份逻辑只创建新文件，不读取、不删除、不修改旧备份。

## 注意

前端密码保护只适合个人轻量访问控制，不等同于服务器级安全认证。真正敏感的数据仍建议放在私有仓库或受保护的托管环境中。
