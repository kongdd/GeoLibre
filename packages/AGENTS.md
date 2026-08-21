# packages/

本目录存放 GeoLibre 前端可复用的 npm workspace。应用层负责组合这些包；包内只保留可复用的领域逻辑、渲染能力和基础组件。

## 目录说明

| 目录 | 包名 | 职责 |
|---|---|---|
| `collab-core/` | `@geolibre/collab-core` | 协作服务的传输无关核心：通信协议、身份与权限判断、会话状态、消息校验。Cloudflare Worker 和 Node relay 共用；不得依赖 DOM 或宿主 API。 |
| `core/` | `@geolibre/core` | 领域核心和单一数据源：Zustand store、项目格式、图层与样式类型，以及选择、历史、凭据、地理编码等通用逻辑。不得依赖地图渲染或应用 UI。 |
| `embed/` | `@geolibre/embed` | GeoLibre iframe Embed API 的 TypeScript 客户端，封装 `postMessage` 请求、事件和类型。当前唯一独立发布到 npm 的包。 |
| `map/` | `@geolibre/map` | 地图渲染层：MapLibre/Cesium 画布、图层同步、地图控制器、数据源、PMTiles，以及 Mapbox Style、SLD、QML 的导入导出。状态修改应先进入 `core` store，再由此包同步到地图。 |
| `plugins/` | `@geolibre/plugins` | 插件系统与内置插件：插件接口、管理器、面板和工具栏注册表，以及数据源、栅格、三维、时序、编辑等集成。新增内置插件还需在应用的 `usePlugins.ts` 注册。 |
| `processing/` | `@geolibre/processing` | 客户端空间分析：矢量、栅格、网络、统计和 DGGS 算法，WASM/Worker 调度、模型图，以及 Python sidecar 客户端。不要在此实现 UI。 |
| `ui/` | `@geolibre/ui` | 通用 React UI 原语和全局样式，主要封装 Radix UI。只放可跨业务复用的组件，不放 GeoLibre 领域逻辑。 |

## 依赖方向

```text
core ──► map ──► plugins
  └────► processing

ui、embed、collab-core 相互独立
```

禁止反向依赖；应用专属组合逻辑放在 `apps/geolibre-desktop/`。

## 开发约定

- 公共入口统一由各包的 `src/index.ts` 导出，避免跨包引用未公开的内部文件。
- 默认从仓库根目录安装、构建和测试：`npm install`、`npm run build`、`npm run test:frontend`。
- 除 `embed` 外，各包目前均为私有源码 workspace，不是可直接发布的 npm 制品。
- 修改 `core` 的类型、store 或项目格式前，检查 `map`、`plugins`、`processing` 和应用层调用方。
