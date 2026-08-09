# 员工版「开发者模式」入口实现说明

## 推荐落地（what-herstaff）

1. 在 `apps/web/src/components.tsx` 导航或用户菜单增加：

```ts
{ path: "/developer", label: "开发者模式", icon: Code }
```

2. 路由页行为：

- **Desktop（Wails）**：调用 bridge `OpenExternal("http://127.0.0.1:5173")` 或启动 `her-dock-host` + 打开工作台。
- **Web**：展示「请使用桌面端」与 Host 下载/启动说明。

3. Launch payload（后续 deep-link）：

```json
{
  "orgId": "<from session>",
  "accessToken": "<short lived>",
  "apiBaseUrl": "<herstaff api>",
  "preferredProvider": "codex"
}
```

一期可先静态打开 her-dock UI，策略使用 Host 内置 Demo org policy。

## her-dock 侧

- Host `GET /v1/policy` 返回 demo bundle。
- 未来 `PUT /v1/policy` 可由员工版 token 换取后下发真实 PolicyBundle。
