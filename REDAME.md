# cesium-3d-webgis

学习 Cesium 三维 WebGIS 的练习仓库。2026 年 9 月中旬开始，约 20 天，
从零学习 JavaScript 基础和 Cesium 三维可视化。

## 运行方式

需要 Cesium 1.145 环境和一个本地 Web 服务器，直接双击 HTML 无法运行：

    python -m http.server 8080

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `myFirst.html` | 基础实体（点/标签/折线/椭圆/多边形）、相机 `flyTo`、屏幕点击拾取并反算经纬度 |
| `mini.html` | 用 `SampledPositionProperty` 配合时钟实现位置插值动画 |
| `school.html` | 加载 3D Tiles 倾斜摄影模型，调用漫游库，通过 `modelMatrix` 校正模型高度 |
| `school.geojson` | 手写的校园要素数据（点/线/面） |
| `tileset.json` | 校园3D Tiles 索引文件，模型数据约数 GB，体积过大未包含，模型来在无人机倾斜摄影，导入ccc中建模而成 |

## 说明

- `Roaming.js` 是第三方库，来自 DEUGlobe 三维地球框架，
  非本人编写，本仓库仅作调用演示。
- 倾斜摄影模型数据未上传，因此 `school.html` 无法直接运行。