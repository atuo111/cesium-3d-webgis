# cesium-3d-webgis

学习 Cesium 三维 WebGIS 的练习仓库。2026 年 9 月中旬开始，从零学习
JavaScript 基础与 Cesium 三维可视化，记录每一步的练习代码。

技术栈：Cesium 1.145 · JavaScript · 3D Tiles · 倾斜摄影模型

## 运行方式

需要 Cesium 1.145 环境和一个本地 Web 服务器，直接双击 HTML 打不开：

    python -m http.server 8080

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `myFirst.html` | 基础实体（点 / 标签 / 折线 / 椭圆 / 多边形）、相机 `flyTo`、屏幕点击拾取并反算经纬度 |
| `mini.html` | 用 `SampledPositionProperty` 配合 Viewer 时钟实现位置插值动画 |
| `school.html` | 加载 3D Tiles 倾斜摄影模型，通过 `modelMatrix` 校正模型高程，并调用漫游库演示相机漫游 |
| `school.geojson` | 手写的校园要素数据（点 / 线 / 面） |
| `Roaming.js` | 第三方漫游库，非本人编写，详见下方说明 |
| `tileset.json` | 3D Tiles 索引文件。模型由无人机倾斜摄影采集、ContextCapture 建模，数据约数 GB，体积过大未包含 |

## 说明

- `Roaming.js` 是第三方库，来自 DEUGlobe 三维地球框架，非本人编写，本仓库仅作调用演示。
- 倾斜摄影模型数据未上传，因此 `school.html` 无法直接运行。

## 待办

- [ ] 用 `SampledPositionProperty` 自己实现相机漫游，替换第三方库
- [ ] 增加建筑轮廓图层，实现点选高亮与属性查询
- [ ] 增加三维量测（距离 / 面积 / 高度）
