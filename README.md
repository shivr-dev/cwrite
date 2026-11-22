# cwrite · CTB Junior 协作室

面向 3–5 人 CTB Junior 团队的网页报告编辑器。正式账号可创建一个协作室，团队成员可凭邀请码、昵称和密码加入，无需邮箱或注册。组长可以发放编辑或只读邀请、调整权限、撤销成员并保存正文版本。

## 本地预览

需要 Node.js 24。项目已配置首尔 Supabase。如需切换后端，复制 `.env.example` 为 `.env.local`，填入对应项目 URL 和 Publishable key。运行：

```sh
npm ci
npm run dev
```

浏览器访问 `http://localhost:5173/`。本地示例的数据只保存在当前浏览器。用邀请链接从另一台设备加入时，链接需使用部署后的网址。

## GitHub Pages 部署

1. 将本目录的源码提交到 `cwrite` 仓库的 `main` 分支。GitHub Free 需要公开源码仓库。文稿、聊天和成员数据由 Supabase 的访问规则保护，源码仓库里没有团队文档。
2. 默认连接已部署的首尔项目。若要切换后端，在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 同时配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。客户端用 [Publishable key](https://supabase.com/dashboard/project/qupzgvuzowqaembyhijg/settings/api-keys)。
3. 在 **Settings → Pages** 选择 **GitHub Actions**。从 Actions 启动 **Deploy cwrite to GitHub Pages**，或推送到 `main` 触发部署。部署成功后用 Actions 显示的网址，个人账户的默认地址是 `https://<账号>.github.io/cwrite/`。
4. 在 Supabase **Authentication → URL Configuration** 把 Site URL 改成上一步的实际网址。测试邮箱确认时，将 `http://127.0.0.1:5173/` 和 `http://localhost:5173/` 加入 Redirect URLs。
5. 组长可由项目管理员在 Supabase **Authentication → Users** 创建已确认账号。若希望组长在网页自行注册和收确认邮件，先配置 [Supabase 自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。游客直接加入，无需邮件服务。

[GitHub Pages 自定义部署流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 后端和验证

当前项目位于韩国首尔 `ap-northeast-2`。迁移文件位于 `supabase/migrations/`，游客服务在 `supabase/functions/ctb-guest/`。新的 Supabase 环境需应用全部迁移，并部署 `ctb-guest`。该函数用邀请码验证入会，自行处理登录。函数的 Service role key 只来自 Supabase 服务端环境。

```sh
npm test
npm run build
```

在校内的 Edge 或 Chrome 打开**正式网址**。用两个独立浏览器窗口分别作为组长和游客打开同一房间。同时编辑不同位置，确认双方内容合并，然后发送聊天并刷新网页。将游客改成只读，再确认其无法修改正文。最后下载一次 DOCX。校内如果能打开网页，但登录、加入或同步失败，请同时核对该校是否允许访问 GitHub Pages 域名和上面的 Supabase 域名。若 WebSocket 受限而 HTTPS 可达，协作会自动改用 HTTP 轮询。

## 文档和备份

可编辑标题、字体、字号、强调格式、列表、缩进、行距、对齐、链接和表格。队友最近编辑的位置会短暂显示昵称。聊天开关不改变 A4 正文的行宽。点击「打印 / PDF」查看实际分页。DOCX 导入会尽量保留编辑器支持的格式。页眉页脚、脚注、修订、浮动对象、宏及复杂排版可能与 Word 不同。

从「分享与成员 → 报告备份」可由组长保存或还原正文。还原前会自动保存当前版本，也可将正文下载成 JSON 或 DOCX。此处的报告备份只包含正文，不含聊天和成员资料。若需备份整个数据库，用 Supabase CLI 的导出流程并单独保护备份文件。
