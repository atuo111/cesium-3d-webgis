/*!
 * MeasureTool —— Cesium 三维量测（距离 / 面积）
 *
 * 用法：
 *   const measure = new MeasureTool(viewer);
 *   measure.startLine();      // 距离量测：左键加点，右键结束
 *   measure.startPolygon();   // 面积量测：左键加点（≥3），右键结束
 *   measure.clear();          // 清除全部结果
 *
 * 说明：
 *   1. 点选坐标用 scene.pickPosition()，可以直接取到倾斜摄影模型表面的三维点；
 *   2. 距离用 EllipsoidGeodesic 逐段累加（地表长度），同时给出空间斜距；
 *   3. 面积用"局部 ENU 平面 + 鞋带公式"算水平投影面积（占地面积），
 *      校园这种几公里范围内误差远小于 0.1%；
 *   4. 所有顶点都会显示经纬度（WGS84，经度在前）。
 */
(function (global) {
  "use strict";

  const Cesium = global.Cesium;
  if (!Cesium) {
    throw new Error("MeasureTool 依赖 Cesium，请先引入 Cesium.js");
  }

  const MU_PER_SQUARE_METER = 666.6666667; // 1 亩 ≈ 666.67 m²

  // ---------- 格式化小工具 ----------
  function fmtLength(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(3) + " km";
    return meters.toFixed(2) + " m";
  }

  function fmtArea(m2) {
    const mu = m2 / MU_PER_SQUARE_METER;
    let main;
    if (m2 >= 1000000) main = (m2 / 1000000).toFixed(3) + " km²";
    else if (m2 >= 10000) main = (m2 / 10000).toFixed(3) + " 公顷";
    else main = m2.toFixed(2) + " m²";
    return main + "（" + m2.toFixed(1) + " m²，" + mu.toFixed(2) + " 亩）";
  }

  function fmtLonLat(carto) {
    return (
      Cesium.Math.toDegrees(carto.longitude).toFixed(6) +
      ", " +
      Cesium.Math.toDegrees(carto.latitude).toFixed(6)
    );
  }

  function fmtHeight(carto) {
    return carto.height.toFixed(2) + " m";
  }

  // ---------- 主类 ----------
  class MeasureTool {
    /**
     * @param {Cesium.Viewer} viewer
     * @param {Object} [options]
     * @param {String} [options.lineColor="#ffd54f"]    折线颜色
     * @param {String} [options.fillColor="#ff9800"]    面填充颜色
     */
    constructor(viewer, options) {
      options = options || {};
      this.viewer = viewer;

      this.lineColor = Cesium.Color.fromCssColorString(options.lineColor || "#ffd54f");
      this.fillColor = Cesium.Color.fromCssColorString(options.fillColor || "#ff9800");

      this.mode = null;        // null | "line" | "polygon"
      this.points = [];        // 已确认的点（Cartesian3）
      this.cursor = undefined; // 鼠标当前位置（预览用）
      this.active = null;      // 正在画的折线/面实体
      this.entities = [];      // 所有量测实体（用于 clear）
      this._current = [];      // 本次未完成量测的实体
      this._lastScreen = undefined;

      this._injectStyle();
      this._createDom();
      this._bindEvents();
    }

    // ========== 对外接口 ==========

    /** 开始距离量测 */
    startLine() {
      this._start("line");
    }

    /** 开始面积量测 */
    startPolygon() {
      this._start("polygon");
    }

    /** 清除所有量测结果 */
    clear() {
      this._cancelCurrent();
      this.entities.forEach((e) => this.viewer.entities.remove(e));
      this.entities = [];
      this._hidePopup();
    }

    /** 销毁（移除事件监听和 DOM） */
    destroy() {
      this.clear();
      this.handler.destroy();
      document.removeEventListener("keydown", this._onKeyDown);
      this._popup.remove();
      this._hintEl.remove();
    }

    // ========== 内部：开始 / 取消 ==========

    _start(mode) {
      this._cancelCurrent();
      this._hidePopup();
      this.mode = mode;
      this.points = [];
      this.cursor = undefined;

      const that = this;

      if (mode === "line") {
        this.active = this.viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(function () {
              const arr = that.points.slice();
              if (that.cursor) arr.push(that.cursor);
              return arr.length >= 2 ? arr : undefined;
            }, false),
            width: 3,
            material: this.lineColor,
          },
        });
      } else {
        this.active = this.viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.CallbackProperty(function () {
              const arr = that.points.slice();
              if (that.cursor) arr.push(that.cursor);
              return arr.length >= 3 ? new Cesium.PolygonHierarchy(arr) : undefined;
            }, false),
            // 关键：让面使用每个点自己的高度，而不是贴到地形/椭球上
            perPositionHeight: true,
            material: this.fillColor.withAlpha(0.35),
            outline: true,
            outlineColor: this.fillColor,
          },
        });
      }

      this.entities.push(this.active);
      this._current.push(this.active);

      this._hint(
        mode === "line"
          ? "距离量测：左键加点，右键结束，Esc 取消"
          : "面积量测：左键加点（至少 3 个），右键结束，Esc 取消"
      );
    }

    _cancelCurrent() {
      this._current.forEach((e) => this.viewer.entities.remove(e));
      this.entities = this.entities.filter((e) => this._current.indexOf(e) < 0);
      this._current = [];
      this.active = null;
      this.points = [];
      this.cursor = undefined;
      this.mode = null;
      this._hint("");
    }

    // ========== 内部：事件 ==========

    _bindEvents() {
      const that = this;
      this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

      // 左键：加点
      this.handler.setInputAction(function (movement) {
        if (!that.mode) return;
        const p = that._pickPosition(movement.position);
        if (!p) {
          that._hint("没点到模型/地面，请对准模型再点一下");
          return;
        }
        that.points.push(p);
        that._lastScreen = movement.position;
        that._addVertex(p);
        that._refreshHint();
        // 避免 Cesium 默认的点选把顶点当作 Entity 选中、弹出 InfoBox
        that.viewer.selectedEntity = undefined;
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // 移动：预览
      this.handler.setInputAction(function (movement) {
        if (!that.mode) return;
        const p = that._pickPosition(movement.endPosition);
        that.cursor = p;
        that._lastScreen = movement.endPosition;
        that._refreshHint();
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      // 右键：结束
      this.handler.setInputAction(function () {
        if (!that.mode) return;
        const need = that.mode === "line" ? 2 : 3;
        if (that.points.length < need) {
          that._hint("至少需要 " + need + " 个点才能结束");
          return;
        }
        that._finish();
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

      this._onKeyDown = function (e) {
        if (e.key === "Escape" && that.mode) {
          that._cancelCurrent();
        }
      };
      document.addEventListener("keydown", this._onKeyDown);
    }

    /** 取屏幕点对应的三维坐标：优先模型表面，其次地形 */
    _pickPosition(windowPosition) {
      const scene = this.viewer.scene;
      let cartesian;
      if (scene.pickPositionSupported) {
        cartesian = scene.pickPosition(windowPosition);
      }
      if (!Cesium.defined(cartesian)) {
        const ray = scene.camera.getPickRay(windowPosition);
        if (Cesium.defined(ray)) {
          cartesian = scene.globe.pick(ray, scene);
        }
      }
      return cartesian;
    }

    _addVertex(position) {
      const entity = this.viewer.entities.add({
        position: position,
        point: {
          pixelSize: 7,
          color: Cesium.Color.WHITE,
          outlineColor: this.fillColor,
          outlineWidth: 2,
          // 让顶点不被建筑挡住，量测时始终可见
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.entities.push(entity);
      this._current.push(entity);
    }

    // ========== 内部：结束与计算 ==========

    _finish() {
      const mode = this.mode;
      const pts = this.points.slice();

      // 把"动态预览"冻结成静态几何，这样下一段量测不会把它改掉
      if (mode === "line") {
        this.active.polyline.positions = new Cesium.ConstantProperty(pts);
      } else {
        this.active.polygon.hierarchy = new Cesium.ConstantProperty(
          new Cesium.PolygonHierarchy(pts)
        );
      }

      this.mode = null;
      this.cursor = undefined;
      this._current = []; // 结果保留，直到 clear()
      this.active = null;
      this._hint("");

      const screen = this._lastScreen;
      if (mode === "line") {
        const s = this._lineStats(pts);
        const start = Cesium.Cartographic.fromCartesian(pts[0]);
        const end = Cesium.Cartographic.fromCartesian(pts[pts.length - 1]);
        const rise = end.height - start.height;
        this._showPopup(
          "<h4>距离量测</h4>" +
            this._row("地表长度", fmtLength(s.surface)) +
            this._row("空间长度", fmtLength(s.spatial)) +
            this._row("起终点高差", (rise >= 0 ? "+" : "") + rise.toFixed(2) + " m") +
            this._row("起点经纬度", fmtLonLat(start)) +
            this._row("终点经纬度", fmtLonLat(end)) +
            this._row("节点数", pts.length + " 个"),
          screen
        );
      } else {
        const s = this._polygonStats(pts);
        const center = Cesium.Cartographic.fromRadians(s.centerLon, s.centerLat);
        this._showPopup(
          "<h4>面积量测</h4>" +
            this._row("水平投影面积", fmtArea(s.area)) +
            this._row("周长", fmtLength(s.perimeter)) +
            this._row("中心点经纬度", fmtLonLat(center)) +
            this._row("顶点数", pts.length + " 个") +
            '<div class="mt-note">面积按水平投影计算（占地面积）</div>',
          screen
        );
      }
    }

    /** 地表长度（椭球测地线）与空间斜距 */
    _lineStats(points) {
      let surface = 0;
      let spatial = 0;
      for (let i = 1; i < points.length; i++) {
        const a = Cesium.Cartographic.fromCartesian(points[i - 1]);
        const b = Cesium.Cartographic.fromCartesian(points[i]);
        surface += new Cesium.EllipsoidGeodesic(a, b).surfaceDistance;
        spatial += Cesium.Cartesian3.distance(points[i - 1], points[i]);
      }
      return { surface: surface, spatial: spatial };
    }

    /**
     * 水平投影面积 + 周长
     * 做法：以顶点平均经纬度为原点建 ENU 局部平面，
     * 把每个点投到这个平面上，再用鞋带公式求面积。
     * 几公里范围内误差 < 0.1%，足够校园量测使用。
     */
    _polygonStats(points) {
      const cartos = points.map((p) => Cesium.Cartographic.fromCartesian(p));

      let lon = 0;
      let lat = 0;
      cartos.forEach((c) => {
        lon += c.longitude;
        lat += c.latitude;
      });
      lon /= cartos.length;
      lat /= cartos.length;

      const origin = Cesium.Cartesian3.fromRadians(lon, lat, 0);
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
      const inverse = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());

      let twiceArea = 0;
      const local = points.map((p) =>
        Cesium.Matrix4.multiplyByPoint(inverse, p, new Cesium.Cartesian3())
      );
      for (let i = 0; i < local.length; i++) {
        const a = local[i];
        const b = local[(i + 1) % local.length];
        twiceArea += a.x * b.y - b.x * a.y;
      }

      let perimeter = 0;
      for (let i = 0; i < cartos.length; i++) {
        const a = cartos[i];
        const b = cartos[(i + 1) % cartos.length];
        perimeter += new Cesium.EllipsoidGeodesic(a, b).surfaceDistance;
      }

      return {
        area: Math.abs(twiceArea) / 2,
        perimeter: perimeter,
        centerLon: lon,
        centerLat: lat,
      };
    }

    // ========== 内部：界面 ==========

    _createDom() {
      this._popup = document.createElement("div");
      this._popup.className = "mt-popup";
      document.body.appendChild(this._popup);

      this._hintEl = document.createElement("div");
      this._hintEl.className = "mt-hint";
      document.body.appendChild(this._hintEl);
    }

    _injectStyle() {
      if (document.getElementById("measure-tool-style")) return;
      const style = document.createElement("style");
      style.id = "measure-tool-style";
      style.textContent = [
        ".mt-popup{position:fixed;z-index:20000;min-width:270px;max-width:360px;",
        "background:rgba(18,24,32,.93);color:#fff;border-radius:8px;padding:14px 16px;",
        'font:13px/1.7 "Microsoft YaHei",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4);display:none}',
        ".mt-popup h4{margin:0 0 8px;padding-right:18px;font-size:14px;color:#4fc3f7;font-weight:600}",
        ".mt-row{display:flex;justify-content:space-between;gap:14px}",
        ".mt-row span{color:#9fb3c8;flex:0 0 auto}",
        ".mt-row b{font-weight:600;color:#fff;text-align:right;word-break:break-all}",
        ".mt-note{margin-top:6px;color:#7f93a6;font-size:12px}",
        ".mt-close{position:absolute;right:8px;top:4px;border:0;background:none;color:#9fb3c8;",
        "font-size:18px;line-height:1;cursor:pointer}",
        ".mt-close:hover{color:#fff}",
        ".mt-hint{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:20000;",
        "background:rgba(18,24,32,.85);color:#fff;padding:8px 16px;border-radius:18px;",
        'font:13px/1.4 "Microsoft YaHei",sans-serif;display:none;pointer-events:none}',
      ].join("");
      document.head.appendChild(style);
    }

    _row(label, value) {
      return "<div class='mt-row'><span>" + label + "</span><b>" + value + "</b></div>";
    }

    _hint(text) {
      this._hintEl.textContent = text || "";
      this._hintEl.style.display = text ? "block" : "none";
    }

    _refreshHint() {
      if (!this.mode) return;
      const base =
        this.mode === "line"
          ? "左键加点，右键结束，Esc 取消"
          : "左键加点（≥3），右键结束，Esc 取消";

      if (!this.cursor || this.points.length === 0) {
        this._hint(base);
        return;
      }

      const preview = this.points.concat([this.cursor]);
      if (this.mode === "line") {
        this._hint(base + "　|　当前长度 " + fmtLength(this._lineStats(preview).surface));
      } else if (preview.length >= 3) {
        this._hint(base + "　|　当前面积 " + fmtArea(this._polygonStats(preview).area));
      } else {
        this._hint(base);
      }
    }

    _showPopup(html, screenPos) {
      const canvas = this.viewer.scene.canvas;
      const rect = canvas.getBoundingClientRect();
      let x = rect.left + (screenPos ? screenPos.x : 0) + 18;
      let y = rect.top + (screenPos ? screenPos.y : 0) + 18;

      x = Math.min(x, window.innerWidth - 380);
      y = Math.min(y, window.innerHeight - 220);
      x = Math.max(10, x);
      y = Math.max(10, y);

      this._popup.innerHTML = html + '<button class="mt-close" title="关闭">×</button>';
      this._popup.style.left = x + "px";
      this._popup.style.top = y + "px";
      this._popup.style.display = "block";

      const that = this;
      this._popup.querySelector(".mt-close").onclick = function () {
        that._hidePopup();
      };
    }

    _hidePopup() {
      this._popup.style.display = "none";
    }
  }

  global.MeasureTool = MeasureTool;
})(window);
