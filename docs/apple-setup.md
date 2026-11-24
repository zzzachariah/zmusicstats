# Apple Music 本机配置

网站已经有 MusicKit 授权入口，接入前还需要开发者 Token。开发者 Token 用于识别本项目；每位用户的 Apple Music 授权仍由本人在 Apple 页面完成。

## 准备材料

选择其中一组：

- Apple Developer 的 **Team ID**、启用 MusicKit 的 **Key ID**，以及相应 **`.p8` 文件的本机完整路径**。
- 一枚已签发且仍有效的 **Apple Music developer Token**。

不用把私钥内容或 Token 发到聊天中。

如果已有 Apple Developer 账户但尚未创建这份凭证，Apple 的官方流程为：

1. 在 **Certificates, Identifiers & Profiles → Identifiers** 新建 **Media ID**。描述可以使用 `zmusicstats`；用户授权时会看到此应用名称。
2. 设置反向域名形式的标识符，启用 MusicKit 对应服务。标识符应使用自己的命名空间。
3. 在 **Keys** 新建密钥，启用 **Media Services** 并关联刚才的 Media ID；下载 `.p8`。
4. 保存 **Key ID**。在账户的会员信息中查看 **Team ID**。

此操作需要 Account Holder 或 Admin 角色。Apple 的私钥文件只允许下载一次，保存在自己的安全位置即可，本工具不复制私钥。[创建 Media ID 和密钥](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/)、[创建私钥](https://developer.apple.com/help/account/keys/create-a-private-key/)

## 本机运行

在项目目录的终端执行：

```sh
node server/configure-apple.mjs
```

按照提示选择：

- **使用 `.p8` 签发**：输入 Team ID、Key ID，然后粘贴 `.p8` 的完整路径。路径输入隐藏，支持 `~/`，也支持用引号包裹含空格的路径。
- **使用现成 Token**：粘贴完整 developer JWT。输入隐藏，不会回显到终端。

不要把密钥、Token 或其它凭证作为命令行参数；工具也不接受管道输入。`Ctrl+C` 可以取消。

工具使用 Node 内置密码学功能，在本机以 **ES256 / P-256 / SHA-256** 签发有效期约 **30 天** 的 JWT。请求头包含 Key ID，声明包含 Team ID、签发和到期时间。Apple 规定开发者 Token 最长不超过约六个月，本工具采用更短有效期。[Apple 官方签名规范](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)

随后工具向 Apple 官方的 `https://api.music.apple.com/v1/test` 验证 Token。**只有 Apple 返回成功后**，才更新项目 `.env` 中的 `APPLE_MUSIC_DEVELOPER_TOKEN`，保留其它配置，并将文件权限设为 `0600`。私钥只在本机内存中用于签名，不复制到项目，也不写入配置。Token 不会打印到终端。[官方验证请求说明](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens.md)

更新后重启开发服务，再到网页点击连接 Apple Music。到期后重新运行本工具即可。工具不创建开发者账号、不购买会员、不接受 Apple 协议，也不会自动操作 Apple 登录页面。

## 当前来源约束

当前本机流程同时需要浏览器授权和服务端请求 Apple API，因此新签发的 Token 暂不加入 `origin` 声明。正式上线时，应结合网页域名和服务端请求方式配置来源限制。已有带 `origin` 限制的 Token 若未通过当前服务端验证，工具不会写入；不要通过关闭验证来强行使用。

## 自检与故障

```sh
node server/configure-apple.mjs --self-test
```

自检使用临时生成的本机测试密钥及模拟响应，验证 JWT 签名格式、过期检查、验证失败不写入、保留其它环境变量、文件权限和错误密钥拒绝。它不连接 Apple，也不读写项目的真实 `.env`。

- **401**：检查 Team ID、Key ID、签名私钥和到期时间。
- **403**：检查 MusicKit／Media ID 关联、账号角色和 Token 来源限制。
- **429／网络失败**：稍后重试；验证失败不修改现有配置。
- **没有可用的 `.p8`**：在开发者账户中确认现有密钥；已经下载过的私钥无法再次下载，需要由账户管理员处理。

凭证配置成功只代表开发者接入有效，并不代表 API 会提供任意月份的总时长或完整播放历史。报告仍须按实际返回的数据和周期展示。
