# GeoLibre 公网入口与 Caddy 配置

本机已通过 Caddy + Rathole 将 GeoLibre 暴露为 `https://ecohydro.top:5173`，项目 API 同源代理，OpenFreeMap 与 Google Map 瓦片经本机转发。

## 当前拓扑

```text
浏览器
  → 175.178.125.10:5173（腾讯云 Rathole 服务端）
  → kong-nas（Rathole 客户端，amd=10.100.1.6）
  → Caddy 10.100.1.6:5173 / 192.168.31.86:5173
       ├ /api/*、/health → 127.0.0.1:8010
       ├ /openfreemap/*               → tiles.openfreemap.org（Otter 缓存）
       ├ /google-map-tiles/public/*    → mt1.google.com（Otter 缓存）
       ├ /google-map-tiles/api/*       → tile.googleapis.com
       └ 其余                          → 127.0.0.1:5173（Vite）
```

- `8010` 不对外映射。
- `pi-web` 走 `443 → 127.0.0.1:30141`，与 `5173` 无关。
- `/mnt/z` 为 CIFS：`//kong-nas/CMIP6`。

## 已验证

| 检查项 | 结果 |
|---|---|
| GeoLibre `https://ecohydro.top:5173/` | 200 |
| 项目 API `/health` | 200 |
| OpenFreeMap 代理首次 | `uri-miss; stored` |
| OpenFreeMap 代理二次 | `hit; detail=OTTER` |
| Google Map 代理 | 200，JPEG 256×256 |
| Caddy | `2.10.0`，含 `cache-handler` + Otter |
| Pi Web `https://ecohydro.top/` | 401（鉴权正常） |

## 故障结论

1. **公网 `5173` 曾打不开**：Caddy 与 Rathole 服务端均正常；NAS 访问 `amd:443` 通、`5173–5175` 超时。根因是本机 UFW 拦截来自 `10.100.1.2` 的 5173–5175。`443` 可用是因为 Caddy 监听 `*:443`。
2. **网页启动极慢**：公网跑的是 Vite 开发服务器，数百个 TS 模块经 Rathole 串行加载。已对 `5173` 启用 `encode zstd gzip`；要根本提速需切生产 `dist`。
3. **地图瓦片慢**：OpenFreeMap 与 Google Map 均改写为同源路径；Google 公共瓦片缓存 60 d。

## 关键文件

- 运行配置：`/etc/caddy/Caddyfile`
- 工作副本：`~/.config/caddy/Caddyfile`
- 安装前备份：`/etc/caddy/Caddyfile.pre-cache.bak`
- 原版二进制：`/usr/bin/caddy.default`
- 自定义二进制：`/usr/bin/caddy.custom`

## 待办

1. 本机放行 Rathole 客户端：

```bash
sudo ufw allow from 10.100.1.2 to 10.100.1.6 port 5173:5175 proto tcp
```

2. 公网稳定后改用 `vite preview` 或 Caddy 静态托管 `apps/geolibre-desktop/dist`。
3. `5174`/`5175` 上游未常驻；Caddy 已预留端口。
