# 构建与发布

## 本机构建

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build:desktop
```

Tauri 当前平台会生成调试或发布构件。GitHub `desktop-artifacts.yml` 在 Windows 构建 NSIS/MSI 测试构件，在 macOS 构建 universal DMG 测试构件。

## 稳定发布门禁

稳定版发布必须同时具备：

- Windows Authenticode 证书
- Apple Developer ID Application 证书
- Apple notarization 凭据
- Tauri updater signing key 与已提交的 public key
- GitHub Release 权限

仓库默认工作流只上传测试构件，不创建 Stable Release。缺少任一签名或公证材料时不得把构件标记为稳定版。

## 更新通道

应用持久化 `stable` / `preview` 偏好。只有构建时同时设置 `HERDOCK_UPDATER_PUBLIC_KEY` 与对应通道的 HTTPS `HERDOCK_UPDATER_ENDPOINT_STABLE` / `HERDOCK_UPDATER_ENDPOINT_PREVIEW`，检查和安装按钮才会启用。发布工作流还必须生成已签名 updater artifacts；仓库故意不包含占位密钥或默认 endpoint。
