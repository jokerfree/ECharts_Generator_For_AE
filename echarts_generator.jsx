// AE 可编辑图表生成器 v5.2
// v5.2: 移除「预览」面板与整个预览绘制模块（未使用，占版面）；底部只保留「生成图表 / 关闭」。
//       修复正负值柱状图的负值柱方向画反（向上长）导致冲出 Y 轴顶的问题；
//       修复瀑布图增量段的矩形锚点取错（从顶边再向上长一整段高）导致飞出画面的问题。
//       根因：矩形统一写法 Rect Position=[0,-h/2] 的语义是「从锚点向上铺满 h」，
//       故锚点必须按期望区间反推（负值柱 = zeroY+h；瀑布段 = yBot）。
//       瀑布图对齐 ECharts 官网示例：只画增量段 + 柱间连接线，**移除合计柱**
//       （原「合计名称」输入框、"合计柱" 图层、waterfallTotalName 配置一并删除）。
// v5.1: 柱状图新增 堆叠百分比 / 水平堆叠条形 / 正负值 / 瀑布图；折线图新增 渐变面积 / 堆叠折线；
//       「系列样式」拆分为「柱状图样式」「折线图样式」两页，并新增「柱状进阶」页；
//       饼图页精简为常用项（内/外半径、起止角、玫瑰模式、标签、引导线），
//       间隙/最小角度/圆角/标签半径等改为内部默认值；
//       修复堆叠折线 / 水平堆叠 / 堆叠归一化按单系列最大值定轴导致越界的真 bug；
//       修复堆叠归一化各段 y 位置误除以「原始总量」（应为累计占比 × 绘图区高）导致整柱冲出顶部的 bug。
// v5.0: 饼图扩展为 6 种形态（饼图/环形图/半环形图/南丁格尔玫瑰图/圆角环形图/扇区间隙），
//       新增 内-外半径 / startAngle / endAngle / clockwise / padAngle / roseType / minAngle /
//       itemStyle.borderRadius / label 格式 / labelLine 引导线 等 ECharts series-pie 常用配置；
//       新增独立「饼图」页；修复切换类型改写标题、环形内径写死两处问题。
// v4.7: 单行双列布局 / 修复饼图弯曲分割线 / 更新 mock 数据
(function (thisObj) {
    var AUTO_TAG = "AE_CHART_AUTO";

    // ============ 工具函数 ============
    function hexToRgb(hex) {
        if (hex === null || hex === undefined) return [0, 0, 0];
        hex = String(hex).replace(/^#/, '').replace(/\s/g, '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        if (hex.length !== 6 || isNaN(parseInt(hex, 16))) return [0, 0, 0];
        return [parseInt(hex.substring(0,2),16)/255, parseInt(hex.substring(2,4),16)/255, parseInt(hex.substring(4,6),16)/255];
    }
    function hexToUiColor(hex, alpha) { var c = hexToRgb(hex); return [c[0], c[1], c[2], alpha === undefined ? 1 : alpha]; }
    function pickColor(editText) {
        var result;
        try { result = $.colorPicker(); } catch (e) { return; }
        if (result === null || result === undefined || result === -1 || result === "") return;
        var hex;
        if (typeof result === 'number') hex = '#' + ('000000' + result.toString(16)).slice(-6);
        else hex = '#' + String(result).replace(/^#/, '').slice(-6);
        editText.text = hex.toUpperCase();
    }
    function parseNumberList(str) {
        var arr = String(str).split(','), r = [];
        for (var i = 0; i < arr.length; i++) { var n = parseFloat(String(arr[i]).replace(/^\s+|\s+$/g, '')); if (!isNaN(n)) r.push(n); }
        return r;
    }
    function parseStringList(str) {
        var arr = String(str).split(','), r = [];
        for (var i = 0; i < arr.length; i++) { var s = String(arr[i]).replace(/^\s+|\s+$/g, ''); if (s !== '') r.push(s); }
        return r;
    }
    function niceNum(range, round) {
        if (range <= 0) range = 1;
        var exp = Math.floor(Math.log(range) / Math.LN10);
        var frac = range / Math.pow(10, exp);
        var nf;
        if (round) { if (frac < 1.5) nf = 1; else if (frac < 3) nf = 2; else if (frac < 7) nf = 5; else nf = 10; }
        else { if (frac <= 1) nf = 1; else if (frac <= 2) nf = 2; else if (frac <= 5) nf = 5; else nf = 10; }
        return nf * Math.pow(10, exp);
    }
    function calculateTicks(maxValue, tickCount) {
        if (maxValue <= 0) maxValue = 1;
        if (tickCount < 2) tickCount = 2;
        var range = niceNum(maxValue, false);
        var interval = niceNum(range / (tickCount - 1), true);
        if (interval <= 0) interval = 1;
        var niceMax = Math.ceil(maxValue / interval) * interval;
        var ticks = [];
        for (var v = 0; v <= niceMax + interval * 0.5; v += interval) ticks.push(parseFloat(v.toFixed(6)));
        return { max: niceMax, min: 0, interval: interval, ticks: ticks };
    }
    // 支持负值的刻度计算：正负两侧各自取整，返回含 min 的比例刻度
    function calculateTicksSigned(maxValue, minValue, tickCount) {
        if (tickCount < 2) tickCount = 2;
        var pos = maxValue > 0 ? maxValue : 0;
        var neg = minValue < 0 ? Math.abs(minValue) : 0;
        var range = niceNum(Math.max(pos, neg) || 1, false);
        var interval = niceNum(range / (tickCount - 1), true);
        if (interval <= 0) interval = 1;
        var niceMax = pos > 0 ? Math.ceil(pos / interval) * interval : 0;
        var niceMin = neg > 0 ? -Math.ceil(neg / interval) * interval : 0;
        var ticks = [];
        for (var v = niceMin; v <= niceMax + interval * 0.5; v += interval) ticks.push(parseFloat(v.toFixed(6)));
        return { max: niceMax, min: niceMin, interval: interval, ticks: ticks };
    }
    function setLayerOrigin(layer) { layer.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]); }
    function setTextDoc(layer, size, colorHex, justif, bold) {
        var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var doc = prop.value; doc.fontSize = size; doc.fillColor = hexToRgb(colorHex);
        if (justif !== undefined) doc.justification = justif;
        try { doc.fauxBold = (bold === undefined ? true : bold); } catch (e) {}
        prop.setValue(doc);
    }
    function placeText(layer, targetX, centerY, align) {
        var rect = layer.sourceRectAtTime(0, false);
        var anchorX;
        if (align === 'center') anchorX = rect.left + rect.width / 2;
        else if (align === 'right') anchorX = rect.left + rect.width;
        else anchorX = rect.left;
        var anchorY = rect.top + rect.height / 2;
        var tf = layer.property("ADBE Transform Group");
        tf.property("ADBE Anchor Point").setValue([anchorX, anchorY]);
        tf.property("ADBE Position").setValue([targetX, centerY]);
    }
    function parseSize(val, total) { if (typeof val === 'string' && val.indexOf('%') > -1) return (parseFloat(val) / 100) * total; return parseFloat(val) || 0; }
    function numInput(txt, def) { var v = parseFloat(txt); return isNaN(v) ? def : v; }
    function fmtValue(v, labelCfg, total) { if (labelCfg.percent && total > 0) return (v / total * 100).toFixed(1) + "%"; return String(v); }
    function getColorByData(colors, i) { return colors[i % colors.length]; }
    function getColorBySeries(colors, i) { return colors[i % colors.length]; }

    // ============ 饼图：类型表 / 预设 / 几何内核 ============
    // ==== PIE_GEOM_BEGIN ====  （纯计算，不依赖任何 AE API；测试脚本按此标记切块独立 eval）
    // 饼图子类型（含 4 种扩展形态）
    var PIE_SUBTYPES = { pie: 1, donut: 1, halfDonut: 1, rose: 1, roundedDonut: 1, padPie: 1 };
    function isPieType(sub) { return PIE_SUBTYPES[sub] === 1; }

    // 每个子类型的默认参数，选中类型时写回面板，让用户直接看到"是什么构成了这种形态"
    // innerR/outerR 为占可绘制半径的百分比；角度沿用 ECharts 约定（90 = 12 点方向）；roseType: none/radius/area
    var PIE_PRESETS = {
        pie:          { innerR: 0,  outerR: 75, startAngle: 90,  endAngle: null, padAngle: 0, roseType: 'none',   borderRadius: 0,  labelPos: 'outside' },
        donut:        { innerR: 40, outerR: 70, startAngle: 90,  endAngle: null, padAngle: 0, roseType: 'none',   borderRadius: 0,  labelPos: 'inside' },
        halfDonut:    { innerR: 40, outerR: 70, startAngle: 180, endAngle: 360,  padAngle: 0, roseType: 'none',   borderRadius: 0,  labelPos: 'outside' },
        rose:         { innerR: 0,  outerR: 75, startAngle: 90,  endAngle: null, padAngle: 0, roseType: 'radius', borderRadius: 0,  labelPos: 'outside' },
        roundedDonut: { innerR: 40, outerR: 70, startAngle: 90,  endAngle: null, padAngle: 0, roseType: 'none',   borderRadius: 10, labelPos: 'inside' },
        padPie:       { innerR: 40, outerR: 70, startAngle: 90,  endAngle: null, padAngle: 5, roseType: 'none',   borderRadius: 10, labelPos: 'outside' }
    };

    // 图表类型注册表：下拉框顺序、类型图标映射、子类型判定全部以此为准（单一数据源，避免索引错位）
    var CHART_TYPES = [
        { sub: 'basic',       type: 'bar',  name: "基础柱状图" },
        { sub: 'grouped',     type: 'bar',  name: "分组柱状图" },
        { sub: 'stacked',     type: 'bar',  name: "堆叠柱状图" },
        { sub: 'stackedNorm', type: 'bar',  name: "堆叠百分比柱状图" },
        { sub: 'horizontal',  type: 'bar',  name: "水平柱状图" },
        { sub: 'horizontalStacked', type: 'bar', name: "水平堆叠条形图" },
        { sub: 'negative',    type: 'bar',  name: "正负值柱状图" },
        { sub: 'waterfall',   type: 'bar',  name: "瀑布图" },
        { sub: 'basic',       type: 'line', name: "基础折线图" },
        { sub: 'smooth',      type: 'line', name: "平滑折线图" },
        { sub: 'area',        type: 'line', name: "面积图" },
        { sub: 'gradientArea',type: 'line', name: "渐变面积图" },
        { sub: 'stackedLine', type: 'line', name: "堆叠折线图" },
        { sub: 'stackedArea', type: 'line', name: "堆叠面积图" },
        { sub: 'step',        type: 'line', name: "阶梯折线图" },
        { sub: 'barLine',     type: 'combo', name: "柱状图+折线图" },
        { sub: 'dualAxis',    type: 'combo', name: "双Y轴组合图" },
        { sub: 'pie',         type: 'pie',  name: "饼图" },
        { sub: 'donut',       type: 'pie',  name: "环形图" },
        { sub: 'halfDonut',   type: 'pie',  name: "半环形图" },
        { sub: 'rose',        type: 'pie',  name: "南丁格尔玫瑰图" },
        { sub: 'roundedDonut',type: 'pie',  name: "圆角环形图" },
        { sub: 'padPie',      type: 'pie',  name: "扇区间隙" }
    ];
    // 折线类子类型（用于样式页提示与生成分支判定）
    var LINE_SUBTYPES = { basic: 1, smooth: 1, area: 1, gradientArea: 1, stackedLine: 1, stackedArea: 1, step: 1 };
    function isLineType(sub) { return LINE_SUBTYPES[sub] === 1 && sub !== undefined; }
    function isBarType(sb, tp) { return tp === 'bar' && !isLineType(sb); }
    // 折线数据点形状（对应 ECharts series-line.symbol）
    var SYMBOL_TYPES = ['circle', 'emptyCircle', 'rect', 'roundRect', 'triangle', 'diamond'];
    function chartTypeNames() {
        var a = [];
        for (var i = 0; i < CHART_TYPES.length; i++) a.push(CHART_TYPES[i].name);
        return a;
    }
    // 玫瑰模式索引 <-> 名称
    var ROSE_MODES = ['none', 'radius', 'area'];
    function roseModeIndexOfName(nm) {
        for (var i = 0; i < ROSE_MODES.length; i++) if (ROSE_MODES[i] === nm) return i;
        return 0;
    }
    function labelPosIndexOfName(nm) {
        var m = ['outside', 'inside', 'center'];
        for (var i = 0; i < m.length; i++) if (m[i] === nm) return i;
        return 0;
    }

    // 饼图标签文本格式（对应 series-pie.label.formatter 的常用写法）
    function fmtPieLabel(fmt, name, value, total) {
        var pct = (total > 0) ? (value / total * 100).toFixed(1) + "%" : "-";
        if (fmt === 'percent') return pct;
        if (fmt === 'name') return String(name === undefined || name === null ? "" : name);
        if (fmt === 'nameValue') return String(name === undefined ? "" : name) + " " + value;
        if (fmt === 'namePercent') return String(name === undefined ? "" : name) + " " + pct;
        return String(value);
    }

    function ptOnCircle(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
    function pushPt(pts, p) {
        var n = pts.length;
        if (n > 0 && Math.abs(pts[n-1][0] - p[0]) < 0.001 && Math.abs(pts[n-1][1] - p[1]) < 0.001) return;
        pts.push(p);
    }
    // 按给定起止角采样圆弧（不归一化，可跨 180 度）
    function appendArcRange(pts, cx, cy, r, aFrom, aTo) {
        var d = aTo - aFrom;
        if (Math.abs(d) < 0.0005 || r <= 0.0005) return;
        var n = Math.max(2, Math.ceil(Math.abs(d) * 24));
        for (var i = 0; i <= n; i++) pushPt(pts, ptOnCircle(cx, cy, r, aFrom + d * i / n));
    }
    // 圆角小弧：绕任意圆心 C，走 aFrom->aTo 的短边
    function appendArcNorm(pts, Cx, Cy, r, fromPt, toPt) {
        if (r <= 0.0005) { pushPt(pts, toPt); return; }
        var a0 = Math.atan2(fromPt[1] - Cy, fromPt[0] - Cx);
        var a1 = Math.atan2(toPt[1] - Cy, toPt[0] - Cx);
        var d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        var n = Math.max(2, Math.ceil(Math.abs(d) * 20));
        for (var i = 0; i <= n; i++) pushPt(pts, ptOnCircle(Cx, Cy, r, a0 + d * i / n));
    }

    // 把每个扇区的"角度区间 + 内外半径"算好，生成 / 标签定位两处共用
    // 角度换算：ECharts 角度自 3 点方向逆时针为正；AE 坐标系 y 轴向下，故 AE弧度 = -ECharts角度
    // 顺时针(clockwise) 即 AE 角度递增
    function computePieLayout(values, pc, availRadius) {
        var n = values.length, total = 0, maxV = 0, i;
        var res = { total: 0, items: [], sweepDeg: 0 };
        if (n === 0) return res;
        for (i = 0; i < n; i++) { total += values[i]; if (values[i] > maxV) maxV = values[i]; }
        res.total = total;
        if (total <= 0) return res;

        var sweepDeg = (pc.endAngle === null || pc.endAngle === undefined) ? 360 : (pc.endAngle - pc.startAngle);
        if (sweepDeg <= 0) sweepDeg += 360;
        if (sweepDeg > 360) sweepDeg = 360;
        res.sweepDeg = sweepDeg;

        var equalAngle = (pc.roseType === 'radius' || pc.roseType === 'area');
        var spans = [], sum = 0;
        for (i = 0; i < n; i++) {
            var sp = equalAngle ? (sweepDeg / n) : (sweepDeg * values[i] / total);
            if (!equalAngle && pc.minAngle > 0 && sp < pc.minAngle) sp = pc.minAngle;
            spans.push(sp); sum += sp;
        }
        if (sum > sweepDeg && sum > 0) {              // minAngle 撑爆总量时按比例回收
            var k = sweepDeg / sum;
            for (i = 0; i < n; i++) spans[i] *= k;
        }

        var dir = pc.clockwise === false ? -1 : 1;
        var a = -pc.startAngle * Math.PI / 180;
        var padRad = pc.padAngle * Math.PI / 180;
        var rInBase = availRadius * pc.innerR / 100;

        for (i = 0; i < n; i++) {
            var rOut = availRadius * pc.outerR / 100;
            if (pc.roseType === 'radius') rOut = availRadius * pc.outerR / 100 * (maxV > 0 ? values[i] / maxV : 0);
            else if (pc.roseType === 'area') rOut = availRadius * pc.outerR / 100 * (maxV > 0 ? Math.sqrt(values[i] / maxV) : 0);
            var spanRad = spans[i] * Math.PI / 180;
            var drawRad = spanRad - padRad;               // padAngle 从扇区两侧各让半个间隙
            if (drawRad < 0) drawRad = 0;                 // 间隙大于扇区本身 -> 收起该扇区，不画反向鬼影
            var a0, a1;
            if (dir > 0) { a0 = a + padRad / 2; a1 = a0 + drawRad; }
            else { a1 = a - padRad / 2; a0 = a1 - drawRad; }
            if (a1 < a0) { var t = a0; a0 = a1; a1 = t; }
            res.items.push({ a0: a0, a1: a1, mid: (a0 + a1) / 2, rIn: Math.min(rInBase, rOut), rOut: rOut,
                             value: values[i], index: i, span: a1 - a0 });
            a = (dir > 0) ? (a + spanRad) : (a - spanRad);
        }
        return res;
    }

    // 单个扇区的顶点序列（含几何圆角）。cx/cy 为圆心。
    function buildPieSectorVerts(item, pc, cx, cy) {
        var pts = [];
        var a0 = item.a0, a1 = item.a1, ri = item.rIn, ro = item.rOut;
        var r = pc.borderRadius > 0 ? pc.borderRadius : 0;
        var span = a1 - a0;
        if (span <= 0.0005 || ro <= 0.0005) return pts;
        var hasHole = ri > 0.001;

        if (hasHole && r > (ro - ri) / 2) r = (ro - ri) / 2;
        if (r > ro / 2) r = ro / 2;
        var sinHalf = Math.sin(span / 2);
        if (r > 0 && sinHalf > 0) { var lim = ro * sinHalf / (1 + sinHalf); if (r > lim) r = lim; }
        if (r < 0.5) r = 0;

        if (r <= 0) {
            if (hasHole) {
                appendArcRange(pts, cx, cy, ro, a0, a1);
                appendArcRange(pts, cx, cy, ri, a1, a0);
            } else {
                pushPt(pts, [cx, cy]);
                appendArcRange(pts, cx, cy, ro, a0, a1);
            }
            return pts;
        }

        var dOut = Math.asin(Math.min(0.999, r / (ro - r)));
        var oS = a0 + dOut, oE = a1 - dOut;

        pushPt(pts, ptOnCircle(cx, cy, ro, oS));
        appendArcRange(pts, cx, cy, ro, oS, oE);

        // 外端圆角：圆心在半径 ro-r、角度 oE
        appendArcNorm(pts, ptOnCircle(cx, cy, ro - r, oE)[0], ptOnCircle(cx, cy, ro - r, oE)[1], r,
                      ptOnCircle(cx, cy, ro, oE), ptOnCircle(cx, cy, (ro - r) * Math.cos(dOut), a1));

        if (hasHole) {
            var dIn = Math.asin(Math.min(0.999, r / (ri + r)));
            var iS = a0 + dIn, iE = a1 - dIn;
            var icE = ptOnCircle(cx, cy, ri + r, iE);
            appendArcNorm(pts, icE[0], icE[1], r, ptOnCircle(cx, cy, (ri + r) * Math.cos(dIn), a1), ptOnCircle(cx, cy, ri, iE));
            appendArcRange(pts, cx, cy, ri, iE, iS);
            var icS = ptOnCircle(cx, cy, ri + r, iS);
            appendArcNorm(pts, icS[0], icS[1], r, ptOnCircle(cx, cy, ri, iS), ptOnCircle(cx, cy, (ri + r) * Math.cos(dIn), a0));
            var ocS = ptOnCircle(cx, cy, ro - r, oS);
            appendArcNorm(pts, ocS[0], ocS[1], r, ptOnCircle(cx, cy, (ro - r) * Math.cos(dOut), a0), ptOnCircle(cx, cy, ro, oS));
        } else {
            pushPt(pts, [cx, cy]);
            var ocS2 = ptOnCircle(cx, cy, ro - r, oS);
            appendArcNorm(pts, ocS2[0], ocS2[1], r, ptOnCircle(cx, cy, (ro - r) * Math.cos(dOut), a0), ptOnCircle(cx, cy, ro, oS));
        }
        return pts;
    }

    // 计算整套扇区（以 0,0 为圆心）的包围盒中心；半环/局部扇形靠它自动居中
    function computePieBBoxOffset(items, pc) {
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, any = false, i, j;
        for (i = 0; i < items.length; i++) {
            var vs = buildPieSectorVerts(items[i], pc, 0, 0);
            for (j = 0; j < vs.length; j++) {
                any = true;
                if (vs[j][0] < minX) minX = vs[j][0];
                if (vs[j][0] > maxX) maxX = vs[j][0];
                if (vs[j][1] < minY) minY = vs[j][1];
                if (vs[j][1] > maxY) maxY = vs[j][1];
            }
        }
        if (!any) return [0, 0];
        return [(minX + maxX) / 2, (minY + maxY) / 2];
    }

    // 引导线折线（labelLine.length 沿半径外伸，length2 水平折出）
    function buildLabelLinePts(cx, cy, rOut, mid, len1, len2) {
        var ox = Math.cos(mid), oy = Math.sin(mid);
        var p1 = [cx + ox * rOut, cy + oy * rOut];
        var p2 = [cx + ox * (rOut + len1), cy + oy * (rOut + len1)];
        var side = ox >= 0 ? 1 : -1;
        var p3 = [p2[0] + side * len2, p2[1]];
        return { pts: [p1, p2, p3], end: p3, elbow: p2, side: side };
    }
    // 平滑引导线：在拐点处用二次贝塞尔倒角
    function buildLabelLineSmoothPts(cx, cy, rOut, mid, len1, len2) {
        var L = buildLabelLinePts(cx, cy, rOut, mid, len1, len2);
        var p1 = L.pts[0], p2 = L.pts[1], p3 = L.pts[2];
        var rr = Math.min(len1, len2, 26) * 0.6;
        var v12 = [p2[0] - p1[0], p2[1] - p1[1]], l12 = Math.sqrt(v12[0]*v12[0] + v12[1]*v12[1]) || 1;
        var v23 = [p3[0] - p2[0], p3[1] - p2[1]], l23 = Math.sqrt(v23[0]*v23[0] + v23[1]*v23[1]) || 1;
        var s = [p2[0] - v12[0]/l12*rr, p2[1] - v12[1]/l12*rr];
        var e = [p2[0] + v23[0]/l23*rr, p2[1] + v23[1]/l23*rr];
        var out = [p1, s], i;
        for (i = 1; i <= 8; i++) {
            var t = i / 8, mt = 1 - t;
            out.push([mt*mt*s[0] + 2*mt*t*p2[0] + t*t*e[0], mt*mt*s[1] + 2*mt*t*p2[1] + t*t*e[1]]);
        }
        out.push(p3);
        return { pts: out, end: p3, elbow: p2, side: (Math.cos(mid) >= 0 ? 1 : -1) };
    }

    // ==== PIE_GEOM_END ====

    // ============ 合成管理 ============
    function sanitizeCompName(name) { var s = String(name); s = s.replace(/[\\\/:*?"<>|]/g, "_"); return s.replace(/^\s+|\s+$/g, ''); }
    function findCompByName(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }
    function clearAutoLayers(comp) {
        for (var i = comp.numLayers; i >= 1; i--) { var L = comp.layer(i); if (L.comment === AUTO_TAG) L.remove(); }
    }
    function addShapeLayer(comp, name) { var L = comp.layers.addShape(); L.name = name || "形状"; L.comment = AUTO_TAG; return L; }
    function addTextLayer(comp, text, name) { var L = comp.layers.addText(text); L.name = name || "文字"; L.comment = AUTO_TAG; return L; }

    // ============ 动画 ============
    function applyElasticY(sp, d, dl) {
        var c1 = 2.2, c3 = c1 + 1;
        sp.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1 + ";c3=" + c3 + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[value[0],s*100]";
        sp.expressionEnabled = true;
    }
    function applyElasticX(sp, d, dl) {
        var c1 = 2.2, c3 = c1 + 1;
        sp.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1 + ";c3=" + c3 + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[s*100,value[1]]";
        sp.expressionEnabled = true;
    }
    function applyElasticScale(sp, d, dl) {
        var c1 = 2.5, c3 = c1 + 1;
        sp.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1 + ";c3=" + c3 + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[s*100,s*100]";
        sp.expressionEnabled = true;
    }
    function applyEaseOutTrim(tp, d, dl) {
        tp.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\ns=1-Math.pow(1-t,3);s*100";
        tp.expressionEnabled = true;
    }
    function applyFadeIn(op, d, dl) {
        op.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nt*100";
        op.expressionEnabled = true;
    }
    function applyLabelPop(sp, op, d, dl) {
        var c1 = 2.5, c3 = c1 + 1;
        sp.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1 + ";c3=" + c3 + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[s*100,s*100]";
        sp.expressionEnabled = true;
        op.expression = "delay=" + dl + ";d=" + (d*0.5) + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nt*100";
        op.expressionEnabled = true;
    }
    function applyTextEnter(layer, d, dl, ox, oy) {
        var tf = layer.property("ADBE Transform Group");
        var pos = tf.property("ADBE Position");
        var op = tf.property("ADBE Opacity");
        if (ox && oy) {
            var c1 = 1.4, c3 = c1 + 1;
            pos.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1 + ";c3=" + c3 + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[value[0]+" + ox + "*(1-s),value[1]+" + oy + "*(1-s)]";
            pos.expressionEnabled = true;
        } else if (oy) {
            var c1b = 1.4, c3b = c1b + 1;
            pos.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1b + ";c3=" + c3b + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[value[0],value[1]+" + oy + "*(1-s)]";
            pos.expressionEnabled = true;
        } else if (ox) {
            var c1c = 1.4, c3c = c1c + 1;
            pos.expression = "delay=" + dl + ";d=" + d + ";\nt=(time-inPoint-delay)/d;if(t<0)t=0;if(t>1)t=1;\nc1=" + c1c + ";c3=" + c3c + ";\ns=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);if(s<0)s=0;\n[value[0]+" + ox + "*(1-s),value[1]]";
            pos.expressionEnabled = true;
        }
        applyFadeIn(op, d * 0.6, dl);
    }
    function computeBarLabelY(pos, baseY, barTop, barH, fs, autoFall) {
        if (pos === 'top') return baseY - barH - fs * 0.7;
        if (pos === 'bottom') return baseY + fs * 0.7;
        if (autoFall && barH < fs * 1.3) return baseY - barH - fs * 0.7;
        return baseY - barH / 2;
    }
    function computeLegendLayout(comp, config) {
        var fontSize = config.legend.fontSize;
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var labels;
        if (isPieType(config.chartSubtype)) labels = config.labels;
        else labels = config.legendLabels;
        if (!labels || labels.length === 0) { labels = []; for (var k = 0; k < colors.length; k++) labels.push("系列" + (k + 1)); }
        var n = Math.min(labels.length, colors.length);
        var boxW = Math.round(fontSize * 0.85), gapBlock = Math.round(fontSize * 0.4), gapItem = Math.round(fontSize * 1.2);
        var maxTextW = 0;
        for (var m = 0; m < n; m++) {
            var tmp = comp.layers.addText(labels[m]); tmp.comment = AUTO_TAG;
            setTextDoc(tmp, fontSize, config.legend.textColor);
            var w = tmp.sourceRectAtTime(0, false).width;
            if (w > maxTextW) maxTextW = w;
            tmp.remove();
        }
        var horizontalW = 0;
        for (var i = 0; i < n; i++) horizontalW += boxW + gapBlock + maxTextW + gapItem;
        horizontalW -= gapItem;
        var itemH = Math.round(boxW * 1.6);
        return { n: n, labels: labels, colors: colors, boxW: boxW, gapBlock: gapBlock, gapItem: gapItem,
                 maxTextW: maxTextW, horizontalW: horizontalW, verticalH: n * itemH, verticalW: boxW + gapBlock + maxTextW, itemH: itemH };
    }

    // ============ UI 控件（半宽一行） ============
    // 创建一个半宽的输入项（标签 + 输入框），占整行的 50%
    function makeHalfField(parent, label, defaultValue, chars, hasColorBtn) {
        var g = parent.add("group");
        g.orientation = "row";
        g.alignChildren = ["left", "center"];
        g.alignment = ["left", "center"];
        g.spacing = 3;
        g.preferredSize.width = 255;

        var lbl = g.add("statictext", undefined, label);
        lbl.preferredSize.width = 70;

        var txt = g.add("edittext", undefined, defaultValue);
        txt.characters = chars || 8;
        txt.preferredSize.width = hasColorBtn ? 130 : 175;
        txt.alignment = ["left", "center"];

        if (hasColorBtn) {
            var btn = g.add("button", undefined, "选");
            btn.preferredSize.width = 30;
            btn.onClick = function () { pickColor(txt); };
        }
        return txt;
    }

    // 一行两个输入项
    function addRow2(parent, field1, field2) {
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = ["fill", "center"];
        row.alignment = ["fill", "top"];
        row.spacing = 6;

        var left = row.add("group");
        left.orientation = "row";
        left.alignChildren = ["left", "center"];
        left.alignment = ["left", "center"];
        left.preferredSize.width = 260;

        var right = row.add("group");
        right.orientation = "row";
        right.alignChildren = ["left", "center"];
        right.alignment = ["left", "center"];
        right.preferredSize.width = 260;

        var txt1 = makeHalfField(left, field1.label, field1.def, field1.chars, field1.hasColor);
        var txt2 = null;
        if (field2) txt2 = makeHalfField(right, field2.label, field2.def, field2.chars, field2.hasColor);

        return [txt1, txt2];
    }

    // ============ UI 主构建 ============
    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "AE 图表生成器 v5.2", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 10;
        if (win instanceof Window) { try { win.size = [600, 880]; } catch(e){} }

        // 状态
        var state = {
            chartTypeIdx: 0,
            titleShow: true, titleText: "基础柱状图", subTitleText: "",
            titleColor: "#FFFFFF", subColor: "#BBBBBB",
            titleSize: "48", subSize: "31", titlePosIdx: 1,
            gridLeft: "160", gridRight: "180", gridTop: "180", gridBottom: "160",
            animInput: "1.2", staggerInput: "0.08",
            xShow: true, xName: "", xLineColor: "#D8D8D8", xLabelColor: "#E8E8E8",
            xLineW: "5", xLabelSize: "31", xSplit: false, xSplitColor: "#555555",
            yShow: true, yName: "", yLineColor: "#D8D8D8", yLabelColor: "#E8E8E8",
            yLineW: "5", yLabelSize: "31", yTickCount: "6",
            ySuffix: "", yRightSuffix: "", ySplit: true, ySplitColor: "#555555",
            seriesCount: "5",
            series: [
                { name: "测试数据A", data: "45,78,23,91,56" },
                { name: "测试数据B", data: "67,34,89,12,73" },
                { name: "测试数据C", data: "82,15,47,69,38" },
                { name: "测试数据D", data: "29,63,85,41,77" },
                { name: "测试数据E", data: "54,96,28,72,19" }
            ],
            labels: "一月,二月,三月,四月,五月",
            colorInput: "#5B8FF9,#61DDAA,#F6BD16,#F6903D,#7262FD",
            legendShow: false, legendPosIdx: 0, legendSize: "31", legendTextColor: "#E8E8E8",
            labelShow: true, labelPosIdx: 1, labelSize: "33", labelColor: "#FFFFFF", labelPercent: false,
            barWidth: "35%", barMaxW: "0", barMinH: "2", barRadius: "8",
            barBorderColor: "#FFFFFF", barBorderW: "0", barOpacity: "100",
            barBgShow: false, barBgColor: "#404040", barBgOpacity: "40",
            lineW: "5", lineTypeIdx: 0, lineSmooth: false, lineSymbol: true, symbolCycle: true,
            symbolSize: "18", symbolBorderColor: "#FFFFFF", symbolBorderW: "3",
            areaCheck: false, areaColor: "#A8C8FF", areaOpacity: "50",
            // 折线数据点样式（ECharts symbol 常用值）
            symbolTypeIdx: 0,
            gradAreaTop: "#5B8FF9", gradAreaBottom: "#1B2A4A", gradAreaOpacity: "70",
            // 柱状图进阶（负值/瀑布/归一化）
            negShowZeroLine: true, negZeroColor: "#FFFFFF",
            waterfallConnector: true, waterfallConnectorColor: "#888888",
            stackLabelFmtIdx: 1,
            pieBorderColor: "#FFFFFF", pieBorderW: "2", pieLabelRadius: "0.65",
            pieInnerR: "0", pieOuterR: "75",
            pieStartAngle: "90", pieEndAngle: "",
            piePadAngle: "0", pieRoseTypeIdx: 0,
            pieClockwise: true, pieMinAngle: "0", pieRadius: "0",
            pieLabelPosIdx: 0, pieLabelFmtIdx: 0,
            pieLabelLineShow: true, pieLabelLineLen: "15", pieLabelLineLen2: "15", pieLabelLineSmooth: false
        };

        var UI_BUSY = false;   // 防重入锁：程序化写回 dropdownlist.selection 会同步派发 onChange

        // 导航按钮（两行，避免 7 个按钮挤在一行溢出 600px 宽）
        var navGroup = win.add("group");
        navGroup.orientation = "column"; navGroup.alignChildren = ["fill", "center"];
        navGroup.spacing = 4; navGroup.alignment = ["fill", "top"];
        var navRow1 = navGroup.add("group");
        navRow1.orientation = "row"; navRow1.alignChildren = ["fill", "center"]; navRow1.spacing = 4;
        var navRow2 = navGroup.add("group");
        navRow2.orientation = "row"; navRow2.alignChildren = ["fill", "center"]; navRow2.spacing = 4;
        var navBtnBasic = navRow1.add("button", undefined, "基础");
        var navBtnAxis = navRow1.add("button", undefined, "坐标轴");
        var navBtnData = navRow1.add("button", undefined, "数据");
        var navBtnBar = navRow1.add("button", undefined, "柱状图样式");
        var navBtnLine = navRow2.add("button", undefined, "折线图样式");
        var navBtnBarAdv = navRow2.add("button", undefined, "柱状进阶");
        var navBtnPie = navRow2.add("button", undefined, "饼图样式");

        // 内容容器
        var contentStack = win.add("group");
        contentStack.orientation = "column"; contentStack.alignChildren = ["fill", "top"];
        contentStack.alignment = ["fill", "top"]; contentStack.spacing = 4;

        // 底部按钮
        var bottomBtnGroup = win.add("group");
        bottomBtnGroup.alignment = "center";
        var generateBtn = bottomBtnGroup.add("button", undefined, "生成图表");
        var closeBtn = bottomBtnGroup.add("button", undefined, "关闭");

        var ui = {};

        // 固定次数的反向删除：不要用 while(children.length>0)，宿主 remove() 个别情况下不生效会死循环打满内存
        function clearContent() {
            var n = contentStack.children.length;
            for (var i = n - 1; i >= 0; i--) { try { contentStack.remove(contentStack.children[i]); } catch (e) {} }
            ui = {};
        }

        function captureValues() {
            try {
                if (ui.typeDropdown && ui.typeDropdown.selection) state.chartTypeIdx = ui.typeDropdown.selection.index;
                if (ui.titleShowCheck) state.titleShow = ui.titleShowCheck.value;
                if (ui.titleText) state.titleText = ui.titleText.text;
                if (ui.subTitleText) state.subTitleText = ui.subTitleText.text;
                if (ui.titleColorText) state.titleColor = ui.titleColorText.text;
                if (ui.subColorText) state.subColor = ui.subColorText.text;
                if (ui.titleSizeInput) state.titleSize = ui.titleSizeInput.text;
                if (ui.subSizeInput) state.subSize = ui.subSizeInput.text;
                if (ui.titlePosDropdown && ui.titlePosDropdown.selection) state.titlePosIdx = ui.titlePosDropdown.selection.index;
                if (ui.gridLeft) state.gridLeft = ui.gridLeft.text;
                if (ui.gridRight) state.gridRight = ui.gridRight.text;
                if (ui.gridTop) state.gridTop = ui.gridTop.text;
                if (ui.gridBottom) state.gridBottom = ui.gridBottom.text;
                if (ui.animInput) state.animInput = ui.animInput.text;
                if (ui.staggerInput) state.staggerInput = ui.staggerInput.text;
                if (ui.xShowCheck) state.xShow = ui.xShowCheck.value;
                if (ui.xAxisName) state.xName = ui.xAxisName.text;
                if (ui.xLineColor) state.xLineColor = ui.xLineColor.text;
                if (ui.xLabelColor) state.xLabelColor = ui.xLabelColor.text;
                if (ui.xLineW) state.xLineW = ui.xLineW.text;
                if (ui.xLabelSize) state.xLabelSize = ui.xLabelSize.text;
                if (ui.xSplitCheck) state.xSplit = ui.xSplitCheck.value;
                if (ui.xSplitColor) state.xSplitColor = ui.xSplitColor.text;
                if (ui.yShowCheck) state.yShow = ui.yShowCheck.value;
                if (ui.yAxisName) state.yName = ui.yAxisName.text;
                if (ui.yLineColor) state.yLineColor = ui.yLineColor.text;
                if (ui.yLabelColor) state.yLabelColor = ui.yLabelColor.text;
                if (ui.yLineW) state.yLineW = ui.yLineW.text;
                if (ui.yLabelSize) state.yLabelSize = ui.yLabelSize.text;
                if (ui.yTickCount) state.yTickCount = ui.yTickCount.text;
                if (ui.ySuffixInput) state.ySuffix = ui.ySuffixInput.text;
                if (ui.yRightSuffixInput) state.yRightSuffix = ui.yRightSuffixInput.text;
                if (ui.ySplitCheck) state.ySplit = ui.ySplitCheck.value;
                if (ui.ySplitColor) state.ySplitColor = ui.ySplitColor.text;
                if (ui.seriesCountInput) state.seriesCount = ui.seriesCountInput.text;
                if (ui.getSeriesRows) {
                    var rows = ui.getSeriesRows();
                    if (rows && rows.length > 0) {
                        state.series = [];
                        for (var i = 0; i < rows.length; i++) state.series.push({ name: rows[i].nameInput.text, data: rows[i].dataInput.text });
                    }
                }
                if (ui.labelsInput) state.labels = ui.labelsInput.text;
                if (ui.colorInput) state.colorInput = ui.colorInput.text;
                if (ui.legendShow) state.legendShow = ui.legendShow.value;
                if (ui.legendPos && ui.legendPos.selection) state.legendPosIdx = ui.legendPos.selection.index;
                if (ui.legendSize) state.legendSize = ui.legendSize.text;
                if (ui.legendTextColor) state.legendTextColor = ui.legendTextColor.text;
                if (ui.labelShow) state.labelShow = ui.labelShow.value;
                if (ui.labelPos && ui.labelPos.selection) state.labelPosIdx = ui.labelPos.selection.index;
                if (ui.labelSize) state.labelSize = ui.labelSize.text;
                if (ui.labelColor) state.labelColor = ui.labelColor.text;
                if (ui.labelPercentCheck) state.labelPercent = ui.labelPercentCheck.value;
                if (ui.barWidth) state.barWidth = ui.barWidth.text;
                if (ui.barMaxW) state.barMaxW = ui.barMaxW.text;
                if (ui.barMinH) state.barMinH = ui.barMinH.text;
                if (ui.barRadius) state.barRadius = ui.barRadius.text;
                if (ui.barBorderColor) state.barBorderColor = ui.barBorderColor.text;
                if (ui.barBorderW) state.barBorderW = ui.barBorderW.text;
                if (ui.barOpacity) state.barOpacity = ui.barOpacity.text;
                if (ui.barBgCheck) state.barBgShow = ui.barBgCheck.value;
                if (ui.barBgColor) state.barBgColor = ui.barBgColor.text;
                if (ui.barBgOpacity) state.barBgOpacity = ui.barBgOpacity.text;
                if (ui.lineW) state.lineW = ui.lineW.text;
                if (ui.lineType && ui.lineType.selection) state.lineTypeIdx = ui.lineType.selection.index;
                if (ui.lineSmoothCheck) state.lineSmooth = ui.lineSmoothCheck.value;
                if (ui.lineSymbolCheck) state.lineSymbol = ui.lineSymbolCheck.value;
                if (ui.symbolCycleCheck) state.symbolCycle = ui.symbolCycleCheck.value;
                if (ui.symbolSize) state.symbolSize = ui.symbolSize.text;
                if (ui.symbolBorderColor) state.symbolBorderColor = ui.symbolBorderColor.text;
                if (ui.symbolBorderW) state.symbolBorderW = ui.symbolBorderW.text;
                if (ui.areaCheck) state.areaCheck = ui.areaCheck.value;
                if (ui.areaColorInput) state.areaColor = ui.areaColorInput.text;
                if (ui.areaOpacity) state.areaOpacity = ui.areaOpacity.text;
                if (ui.symbolType && ui.symbolType.selection) state.symbolTypeIdx = ui.symbolType.selection.index;
                if (ui.gradAreaTopInput) state.gradAreaTop = ui.gradAreaTopInput.text;
                if (ui.gradAreaBottomInput) state.gradAreaBottom = ui.gradAreaBottomInput.text;
                if (ui.gradAreaOpacity) state.gradAreaOpacity = ui.gradAreaOpacity.text;
                if (ui.negZeroCheck) state.negShowZeroLine = ui.negZeroCheck.value;
                if (ui.negZeroColor) state.negZeroColor = ui.negZeroColor.text;
                if (ui.wfConnCheck) state.waterfallConnector = ui.wfConnCheck.value;
                if (ui.wfConnColor) state.waterfallConnectorColor = ui.wfConnColor.text;
                if (ui.stackLabelFmt && ui.stackLabelFmt.selection) state.stackLabelFmtIdx = ui.stackLabelFmt.selection.index;
                if (ui.pieBorderColor) state.pieBorderColor = ui.pieBorderColor.text;
                if (ui.pieBorderW) state.pieBorderW = ui.pieBorderW.text;
                if (ui.pieLabelRadius) state.pieLabelRadius = ui.pieLabelRadius.text;
                if (ui.pieInnerR) state.pieInnerR = ui.pieInnerR.text;
                if (ui.pieOuterR) state.pieOuterR = ui.pieOuterR.text;
                if (ui.pieStartAngle) state.pieStartAngle = ui.pieStartAngle.text;
                if (ui.pieEndAngle) state.pieEndAngle = ui.pieEndAngle.text;
                if (ui.piePadAngle) state.piePadAngle = ui.piePadAngle.text;
                if (ui.pieMinAngle) state.pieMinAngle = ui.pieMinAngle.text;
                if (ui.pieRadius) state.pieRadius = ui.pieRadius.text;
                if (ui.pieRoseType && ui.pieRoseType.selection) state.pieRoseTypeIdx = ui.pieRoseType.selection.index;
                if (ui.pieClockwiseCheck) state.pieClockwise = ui.pieClockwiseCheck.value;
                if (ui.pieLabelPos && ui.pieLabelPos.selection) state.pieLabelPosIdx = ui.pieLabelPos.selection.index;
                if (ui.pieLabelFmt && ui.pieLabelFmt.selection) state.pieLabelFmtIdx = ui.pieLabelFmt.selection.index;
                if (ui.pieLabelLineCheck) state.pieLabelLineShow = ui.pieLabelLineCheck.value;
                if (ui.pieLabelLineLen) state.pieLabelLineLen = ui.pieLabelLineLen.text;
                if (ui.pieLabelLineLen2) state.pieLabelLineLen2 = ui.pieLabelLineLen2.text;
                if (ui.pieLabelLineSmoothCheck) state.pieLabelLineSmooth = ui.pieLabelLineSmoothCheck.value;
            } catch (e) {}
        }

        // 切换饼图形态时，把该形态的推荐参数写回 state 与面板（面板未构建时只更新 state）
        function applyPiePreset(sub) {
            var p = PIE_PRESETS[sub];
            if (!p) return;
            UI_BUSY = true;
            state.pieInnerR = String(p.innerR);
            state.pieOuterR = String(p.outerR);
            state.pieStartAngle = String(p.startAngle);
            state.pieEndAngle = (p.endAngle === null || p.endAngle === undefined) ? "" : String(p.endAngle);
            state.piePadAngle = String(p.padAngle);
            state.pieRoseTypeIdx = roseModeIndexOfName(p.roseType);
            state.pieRadius = String(p.borderRadius);
            state.pieLabelPosIdx = labelPosIndexOfName(p.labelPos);
            if (ui.pieInnerR) ui.pieInnerR.text = state.pieInnerR;
            if (ui.pieOuterR) ui.pieOuterR.text = state.pieOuterR;
            if (ui.pieStartAngle) ui.pieStartAngle.text = state.pieStartAngle;
            if (ui.pieEndAngle) ui.pieEndAngle.text = state.pieEndAngle;
            if (ui.piePadAngle) ui.piePadAngle.text = state.piePadAngle;
            if (ui.pieRadius) ui.pieRadius.text = state.pieRadius;
            if (ui.pieRoseType) ui.pieRoseType.selection = state.pieRoseTypeIdx;
            if (ui.pieLabelPos) ui.pieLabelPos.selection = state.pieLabelPosIdx;
            UI_BUSY = false;
        }

        // === 基础页 ===
        function buildBasicPage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            // 图表类型
            var typeGroup = page.add("group");
            typeGroup.add("statictext", undefined, "图表类型:").preferredSize.width = 80;
            var typeDropdown = typeGroup.add("dropdownlist", undefined, chartTypeNames());
            typeDropdown.selection = state.chartTypeIdx || 0;
            typeDropdown.preferredSize.width = 220;
            ui.typeDropdown = typeDropdown;

            // 标题
            var titlePanel = page.add("panel", undefined, "标题");
            titlePanel.orientation = "column"; titlePanel.alignChildren = ["fill", "top"]; titlePanel.spacing = 3; titlePanel.margins = 8;

            var titleShowCheck = titlePanel.add("checkbox", undefined, "显示标题");
            titleShowCheck.value = state.titleShow;
            ui.titleShowCheck = titleShowCheck;

            // 主标题 / 副标题（一行两个）
            var r1 = addRow2(titlePanel, { label: "主标题:", def: state.titleText, chars: 12 },
                                       { label: "副标题:", def: state.subTitleText, chars: 12 });
            ui.titleText = r1[0]; ui.subTitleText = r1[1];

            // 主/副颜色（一行两个）
            var r2 = addRow2(titlePanel, { label: "主标题色:", def: state.titleColor, chars: 8, hasColor: true },
                                       { label: "副标题色:", def: state.subColor, chars: 8, hasColor: true });
            ui.titleColorText = r2[0]; ui.subColorText = r2[1];

            // 字号 / 位置
            var r3 = addRow2(titlePanel, { label: "主字号:", def: state.titleSize, chars: 5 },
                                       { label: "副字号:", def: state.subSize, chars: 5 });
            ui.titleSizeInput = r3[0]; ui.subSizeInput = r3[1];

            var tg3 = titlePanel.add("group");
            tg3.add("statictext", undefined, "标题位置:").preferredSize.width = 70;
            var titlePosDropdown = tg3.add("dropdownlist", undefined, ["左", "中", "右"]);
            titlePosDropdown.selection = state.titlePosIdx;
            ui.titlePosDropdown = titlePosDropdown;

            // 切换类型：只把该饼图形态的推荐参数写回面板，不再改写「标题」文本框
            typeDropdown.onChange = function () {
                if (UI_BUSY || !typeDropdown.selection) return;
                var tp = CHART_TYPES[typeDropdown.selection.index];
                if (!tp) return;
                if (isPieType(tp.sub)) applyPiePreset(tp.sub);
            };

            // 边距
            var gridPanel = page.add("panel", undefined, "绘图区边距");
            gridPanel.orientation = "column"; gridPanel.alignChildren = ["fill", "top"]; gridPanel.spacing = 3; gridPanel.margins = 8;

            var g1 = addRow2(gridPanel, { label: "左:", def: state.gridLeft, chars: 5 },
                                       { label: "右:", def: state.gridRight, chars: 5 });
            ui.gridLeft = g1[0]; ui.gridRight = g1[1];

            var g2 = addRow2(gridPanel, { label: "上:", def: state.gridTop, chars: 5 },
                                       { label: "下:", def: state.gridBottom, chars: 5 });
            ui.gridTop = g2[0]; ui.gridBottom = g2[1];

            // 动画
            var animPanel = page.add("panel", undefined, "动画");
            animPanel.orientation = "column"; animPanel.alignChildren = ["fill", "top"]; animPanel.spacing = 3; animPanel.margins = 8;

            var a1 = addRow2(animPanel, { label: "时长(秒):", def: state.animInput, chars: 5 },
                                       { label: "错落(秒):", def: state.staggerInput, chars: 5 });
            ui.animInput = a1[0]; ui.staggerInput = a1[1];
        }

        // === 坐标轴页 ===
        function buildAxisPage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            // X 轴
            var xPanel = page.add("panel", undefined, "X 轴");
            xPanel.orientation = "column"; xPanel.alignChildren = ["fill", "top"]; xPanel.spacing = 3; xPanel.margins = 8;

            var xs = xPanel.add("checkbox", undefined, "显示 X 轴");
            xs.value = state.xShow; ui.xShowCheck = xs;

            ui.xAxisName = addRow2(xPanel, { label: "轴名称:", def: state.xName, chars: 18 }, null)[0];

            var x2 = addRow2(xPanel, { label: "轴线色:", def: state.xLineColor, chars: 8, hasColor: true },
                                     { label: "标签色:", def: state.xLabelColor, chars: 8, hasColor: true });
            ui.xLineColor = x2[0]; ui.xLabelColor = x2[1];

            var x3 = addRow2(xPanel, { label: "线宽:", def: state.xLineW, chars: 5 },
                                     { label: "字号:", def: state.xLabelSize, chars: 5 });
            ui.xLineW = x3[0]; ui.xLabelSize = x3[1];

            var xsp = xPanel.add("checkbox", undefined, "显示垂直分割线");
            xsp.value = state.xSplit; ui.xSplitCheck = xsp;
            ui.xSplitColor = addRow2(xPanel, { label: "分割线色:", def: state.xSplitColor, chars: 8, hasColor: true }, null)[0];

            // Y 轴
            var yPanel = page.add("panel", undefined, "Y 轴（饼图/环形图不用）");
            yPanel.orientation = "column"; yPanel.alignChildren = ["fill", "top"]; yPanel.spacing = 3; yPanel.margins = 8;

            var ys = yPanel.add("checkbox", undefined, "显示 Y 轴");
            ys.value = state.yShow; ui.yShowCheck = ys;

            ui.yAxisName = addRow2(yPanel, { label: "轴名称:", def: state.yName, chars: 18 }, null)[0];

            var y2 = addRow2(yPanel, { label: "轴线色:", def: state.yLineColor, chars: 8, hasColor: true },
                                     { label: "标签色:", def: state.yLabelColor, chars: 8, hasColor: true });
            ui.yLineColor = y2[0]; ui.yLabelColor = y2[1];

            var y3 = addRow2(yPanel, { label: "线宽:", def: state.yLineW, chars: 5 },
                                     { label: "字号:", def: state.yLabelSize, chars: 5 });
            ui.yLineW = y3[0]; ui.yLabelSize = y3[1];

            var y4 = addRow2(yPanel, { label: "刻度数量:", def: state.yTickCount, chars: 5 },
                                     { label: "数值后缀:", def: state.ySuffix, chars: 6 });
            ui.yTickCount = y4[0]; ui.ySuffixInput = y4[1];

            ui.yRightSuffixInput = addRow2(yPanel, { label: "右轴后缀:", def: state.yRightSuffix, chars: 8 }, null)[0];

            var ysp = yPanel.add("checkbox", undefined, "显示水平分割线");
            ysp.value = state.ySplit; ui.ySplitCheck = ysp;
            ui.ySplitColor = addRow2(yPanel, { label: "分割线色:", def: state.ySplitColor, chars: 8, hasColor: true }, null)[0];
        }

        // === 数据页 ===
        function buildDataPage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            var dataPanel = page.add("panel", undefined, "数据系列");
            dataPanel.orientation = "column"; dataPanel.alignChildren = ["fill", "top"]; dataPanel.spacing = 3; dataPanel.margins = 8;

            var scg = dataPanel.add("group");
            scg.add("statictext", undefined, "系列数量:").preferredSize.width = 80;
            var seriesCountInput = scg.add("edittext", undefined, state.seriesCount);
            seriesCountInput.characters = 4; seriesCountInput.preferredSize.width = 60;
            ui.seriesCountInput = seriesCountInput;

            var seriesContainer = dataPanel.add("group");
            seriesContainer.orientation = "column"; seriesContainer.alignChildren = ["fill", "top"]; seriesContainer.spacing = 3;

            var seriesRowsLocal = [];
            function rebuildSeriesRows() {
                var rn = seriesContainer.children.length;
                for (var ri = rn - 1; ri >= 0; ri--) { try { seriesContainer.remove(seriesContainer.children[ri]); } catch (e) {} }
                seriesRowsLocal = [];
                var cnt = parseInt(seriesCountInput.text) || 1;
                if (cnt < 1) cnt = 1;
                if (cnt > 5) cnt = 5;
                for (var s = 0; s < cnt; s++) {
                    var src = state.series[s] || { name: "测试数据" + String.fromCharCode(65 + s), data: "10,20,30,40,50" };
                    var r = addRow2(seriesContainer,
                        { label: "系列" + (s+1) + "名:", def: src.name, chars: 8 },
                        { label: "数值:", def: src.data, chars: 14 });
                    seriesRowsLocal.push({ nameInput: r[0], dataInput: r[1] });
                }
                try { seriesContainer.layout.layout(true); } catch (e) {}
                try { win.layout.layout(true); } catch (e) {}
            }
            seriesCountInput.onChanging = rebuildSeriesRows;
            rebuildSeriesRows();
            ui.getSeriesRows = function () { return seriesRowsLocal; };

            ui.labelsInput = addRow2(dataPanel, { label: "分类标签:", def: state.labels, chars: 26 }, null)[0];
            ui.colorInput = addRow2(dataPanel, { label: "色板:", def: state.colorInput, chars: 40 }, null)[0];

            // 图例
            var legendPanel = page.add("panel", undefined, "图例");
            legendPanel.orientation = "column"; legendPanel.alignChildren = ["fill", "top"]; legendPanel.spacing = 3; legendPanel.margins = 8;

            var ls = legendPanel.add("checkbox", undefined, "显示图例");
            ls.value = state.legendShow; ui.legendShow = ls;

            var lg1 = legendPanel.add("group");
            lg1.add("statictext", undefined, "位置:").preferredSize.width = 50;
            var legendPos = lg1.add("dropdownlist", undefined, ["顶部", "底部", "左侧", "右侧"]);
            legendPos.selection = state.legendPosIdx; ui.legendPos = legendPos;

            var lg2 = addRow2(legendPanel, { label: "字号:", def: state.legendSize, chars: 5 },
                                          { label: "文字色:", def: state.legendTextColor, chars: 8, hasColor: true });
            ui.legendSize = lg2[0]; ui.legendTextColor = lg2[1];

            // 数值标签
            var labelPanel = page.add("panel", undefined, "数值标签");
            labelPanel.orientation = "column"; labelPanel.alignChildren = ["fill", "top"]; labelPanel.spacing = 3; labelPanel.margins = 8;

            var ls2 = labelPanel.add("checkbox", undefined, "显示数值");
            ls2.value = state.labelShow; ui.labelShow = ls2;

            var lp1 = labelPanel.add("group");
            lp1.add("statictext", undefined, "位置:").preferredSize.width = 50;
            var labelPos = lp1.add("dropdownlist", undefined, ["顶部 top", "内部 inside", "底部 bottom"]);
            labelPos.selection = state.labelPosIdx; ui.labelPos = labelPos;

            var lp2 = addRow2(labelPanel, { label: "字号:", def: state.labelSize, chars: 5 },
                                          { label: "颜色:", def: state.labelColor, chars: 8, hasColor: true });
            ui.labelSize = lp2[0]; ui.labelColor = lp2[1];

            var pc = labelPanel.add("checkbox", undefined, "显示为百分比（柱状/折线用；饼图在「饼图」页单独设置）");
            pc.value = state.labelPercent; ui.labelPercentCheck = pc;
        }

        // === 柱状图样式页 ===
        // 对应 ECharts series-bar：barWidth / barMaxWidth / itemStyle.{borderRadius,borderColor,borderWidth,opacity} / showBackground / backgroundStyle
        function buildBarStylePage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            var barPanel = page.add("panel", undefined, "柱状图 bar");
            barPanel.orientation = "column"; barPanel.alignChildren = ["fill", "top"]; barPanel.spacing = 3; barPanel.margins = 8;

            var b1 = addRow2(barPanel, { label: "柱宽:", def: state.barWidth, chars: 6 },
                                      { label: "最大宽度:", def: state.barMaxW, chars: 5 });
            ui.barWidth = b1[0]; ui.barMaxW = b1[1];

            var b2 = addRow2(barPanel, { label: "最小高度:", def: state.barMinH, chars: 5 },
                                      { label: "圆角:", def: state.barRadius, chars: 5 });
            ui.barMinH = b2[0]; ui.barRadius = b2[1];

            var b3 = addRow2(barPanel, { label: "描边色:", def: state.barBorderColor, chars: 8, hasColor: true },
                                      { label: "描边宽:", def: state.barBorderW, chars: 5 });
            ui.barBorderColor = b3[0]; ui.barBorderW = b3[1];

            var b4 = addRow2(barPanel, { label: "透明度:", def: state.barOpacity, chars: 5 }, null);
            ui.barOpacity = b4[0];

            var bbc = barPanel.add("checkbox", undefined, "显示柱状背景（柱后全高底柱）");
            bbc.value = state.barBgShow; ui.barBgCheck = bbc;

            var b5 = addRow2(barPanel, { label: "背景色:", def: state.barBgColor, chars: 8, hasColor: true },
                                      { label: "背景透明:", def: state.barBgOpacity, chars: 5 });
            ui.barBgColor = b5[0]; ui.barBgOpacity = b5[1];

            var hintB = page.add("statictext", undefined, "提示：柱状图样式对「基础/分组/堆叠/水平/正负/瀑布/堆叠归一化」等柱状类型生效");
            hintB.alignment = ["left", "top"];
        }

        // === 折线图样式页 ===
        // 对应 ECharts series-line：lineStyle.{width,type} / smooth / symbol / symbolSize / symbolBorder / areaStyle
        function buildLineStylePage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            var linePanel = page.add("panel", undefined, "折线图 line");
            linePanel.orientation = "column"; linePanel.alignChildren = ["fill", "top"]; linePanel.spacing = 3; linePanel.margins = 8;

            var l1 = linePanel.add("group");
            l1.add("statictext", undefined, "线宽:").preferredSize.width = 50;
            var lineW = l1.add("edittext", undefined, state.lineW); lineW.characters = 5; lineW.preferredSize.width = 60;
            ui.lineW = lineW;
            l1.add("statictext", undefined, "线型:").preferredSize.width = 50;
            var lineType = l1.add("dropdownlist", undefined, ["实线", "虚线", "点线"]);
            lineType.selection = state.lineTypeIdx;
            ui.lineType = lineType;

            var lsc = linePanel.add("checkbox", undefined, "平滑曲线");
            lsc.value = state.lineSmooth; ui.lineSmoothCheck = lsc;

            var lsy = linePanel.add("group");
            var lineSymbolCheck = lsy.add("checkbox", undefined, "显示数据点");
            lineSymbolCheck.value = state.lineSymbol; ui.lineSymbolCheck = lineSymbolCheck;
            var symbolCycleCheck = lsy.add("checkbox", undefined, "循环色板");
            symbolCycleCheck.value = state.symbolCycle; ui.symbolCycleCheck = symbolCycleCheck;

            var l2 = addRow2(linePanel, { label: "点大小:", def: state.symbolSize, chars: 5 },
                                       { label: "描边宽:", def: state.symbolBorderW, chars: 5 });
            ui.symbolSize = l2[0]; ui.symbolBorderW = l2[1];

            var l2b = linePanel.add("group");
            l2b.add("statictext", undefined, "点形状:").preferredSize.width = 50;
            var symbolType = l2b.add("dropdownlist", undefined, ["圆形 circle", "空心圆 emptyCircle", "方形 rect", "圆角方形 roundRect", "三角形 triangle", "菱形 diamond"]);
            symbolType.selection = state.symbolTypeIdx; ui.symbolType = symbolType;

            var l3 = addRow2(linePanel, { label: "点描边色:", def: state.symbolBorderColor, chars: 8, hasColor: true }, null);
            ui.symbolBorderColor = l3[0];

            var areaCheckboxRow = linePanel.add("group");
            var areaCheck = areaCheckboxRow.add("checkbox", undefined, "面积填充");
            areaCheck.value = state.areaCheck; ui.areaCheck = areaCheck;

            var l4 = addRow2(linePanel, { label: "面积色:", def: state.areaColor, chars: 8, hasColor: true },
                                       { label: "透明度:", def: state.areaOpacity, chars: 5 });
            ui.areaColorInput = l4[0]; ui.areaOpacity = l4[1];

            // 渐变面积（对应 ECharts areaStyle.color: LinearGradient）
            var gradPanel = page.add("panel", undefined, "渐变面积（渐变面积图 / 面积填充时生效）");
            gradPanel.orientation = "column"; gradPanel.alignChildren = ["fill", "top"]; gradPanel.spacing = 3; gradPanel.margins = 8;

            var g1 = addRow2(gradPanel, { label: "顶部色:", def: state.gradAreaTop, chars: 8, hasColor: true },
                                        { label: "底部色:", def: state.gradAreaBottom, chars: 8, hasColor: true });
            ui.gradAreaTopInput = g1[0]; ui.gradAreaBottomInput = g1[1];

            var g2 = addRow2(gradPanel, { label: "不透明度:", def: state.gradAreaOpacity, chars: 5 }, null);
            ui.gradAreaOpacity = g2[0];

            var hintL = page.add("statictext", undefined, "提示：折线图样式对「基础/平滑/面积/渐变面积/堆叠折线/堆叠面积/阶梯」生效");
            hintL.alignment = ["left", "top"];
        }

        // === 柱状图进阶页 ===
        // 对应 ECharts 常见柱状变体：正负值 / 瀑布图 / 堆叠归一化 / 水平堆叠条形的专属选项
        function buildBarAdvPage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            // 正负值
            var negPanel = page.add("panel", undefined, "正负值柱状图");
            negPanel.orientation = "column"; negPanel.alignChildren = ["fill", "top"]; negPanel.spacing = 3; negPanel.margins = 8;

            var nz = negPanel.add("checkbox", undefined, "显示 0 轴基准线（正负分界）");
            nz.value = state.negShowZeroLine; ui.negZeroCheck = nz;
            ui.negZeroColor = addRow2(negPanel, { label: "基准线色:", def: state.negZeroColor, chars: 8, hasColor: true }, null)[0];

            // 瀑布图
            var wfPanel = page.add("panel", undefined, "瀑布图");
            wfPanel.orientation = "column"; wfPanel.alignChildren = ["fill", "top"]; wfPanel.spacing = 3; wfPanel.margins = 8;

            var hintW = wfPanel.add("statictext", undefined, "数据为增量（可为负，如 100, -30, -20, 40）；逐段累加，无合计柱");
            hintW.alignment = ["left", "top"];

            var wc = wfPanel.add("checkbox", undefined, "显示柱间连接线");
            wc.value = state.waterfallConnector; ui.wfConnCheck = wc;
            ui.wfConnColor = addRow2(wfPanel, { label: "连接线色:", def: state.waterfallConnectorColor, chars: 8, hasColor: true }, null)[0];

            // 堆叠归一化
            var normPanel = page.add("panel", undefined, "堆叠百分比 / 堆叠折线");
            normPanel.orientation = "column"; normPanel.alignChildren = ["fill", "top"]; normPanel.spacing = 3; normPanel.margins = 8;

            var npl = normPanel.add("group");
            npl.add("statictext", undefined, "标签内容:").preferredSize.width = 70;
            var stackLabelFmt = npl.add("dropdownlist", undefined, ["百分比", "原始数值"]);
            stackLabelFmt.selection = state.stackLabelFmtIdx; ui.stackLabelFmt = stackLabelFmt;
            var hintN = normPanel.add("statictext", undefined, "适用于「堆叠百分比柱状图」；百分比按各分类总量计算");
            hintN.alignment = ["left", "top"];
        }

        // === 饼图页 ===
        // 对应 ECharts series-pie：radius / startAngle / endAngle / clockwise / padAngle /
        // roseType / minAngle / itemStyle.borderRadius / label / labelLine
        // 精简版：只保留用户最常改的参数；内半径/间隙/最小角度/圆角等由预设随类型自动给出，
        // 高级项（扇区间隙、最小角度、顺时针、标签半径、引导线段长）改为内部默认值，不再暴露。
        function buildPiePage() {
            var page = contentStack.add("group");
            page.orientation = "column"; page.alignChildren = ["fill", "top"]; page.alignment = ["fill", "top"]; page.spacing = 4;

            var tip = page.add("statictext", undefined, "提示：切换图表类型会按该形态的推荐值重置本页参数");
            tip.alignment = ["left", "top"];

            // 半径与角度
            var geoPanel = page.add("panel", undefined, "半径 / 角度");
            geoPanel.orientation = "column"; geoPanel.alignChildren = ["fill", "top"]; geoPanel.spacing = 3; geoPanel.margins = 8;

            var pr = addRow2(geoPanel, { label: "内半径(%):", def: state.pieInnerR, chars: 6 },
                                       { label: "外半径(%):", def: state.pieOuterR, chars: 6 });
            ui.pieInnerR = pr[0]; ui.pieOuterR = pr[1];

            var pa = addRow2(geoPanel, { label: "起始角:", def: state.pieStartAngle, chars: 6 },
                                       { label: "结束角:", def: state.pieEndAngle, chars: 6 });
            ui.pieStartAngle = pa[0]; ui.pieEndAngle = pa[1];

            var hintA = geoPanel.add("statictext", undefined, "角度按 ECharts 约定：90 = 12 点方向；结束角留空 = 整圆");
            hintA.alignment = ["left", "top"];

            var pgg = geoPanel.add("group");
            pgg.add("statictext", undefined, "玫瑰模式:").preferredSize.width = 70;
            var roseType = pgg.add("dropdownlist", undefined, ["不启用", "半径 roseType: radius", "面积 roseType: area"]);
            roseType.selection = state.pieRoseTypeIdx;
            ui.pieRoseType = roseType;

            // 扇区外观
            var lookPanel = page.add("panel", undefined, "扇区外观");
            lookPanel.orientation = "column"; lookPanel.alignChildren = ["fill", "top"]; lookPanel.spacing = 3; lookPanel.margins = 8;

            var p1 = addRow2(lookPanel, { label: "扇区描边:", def: state.pieBorderColor, chars: 8, hasColor: true },
                                        { label: "描边宽:", def: state.pieBorderW, chars: 5 });
            ui.pieBorderColor = p1[0]; ui.pieBorderW = p1[1];

            // 标签
            var pieLabelPanel = page.add("panel", undefined, "标签");
            pieLabelPanel.orientation = "column"; pieLabelPanel.alignChildren = ["fill", "top"]; pieLabelPanel.spacing = 3; pieLabelPanel.margins = 8;

            var lpl = pieLabelPanel.add("group");
            lpl.add("statictext", undefined, "位置:").preferredSize.width = 50;
            var pieLabelPos = lpl.add("dropdownlist", undefined, ["外部 outside", "扇区内 inside", "圆心合计"]);
            pieLabelPos.selection = state.pieLabelPosIdx; ui.pieLabelPos = pieLabelPos;

            var lpf = pieLabelPanel.add("group");
            lpf.add("statictext", undefined, "格式:").preferredSize.width = 50;
            var pieLabelFmt = lpf.add("dropdownlist", undefined, ["数值", "百分比", "名称", "名称+数值", "名称+百分比"]);
            pieLabelFmt.selection = state.pieLabelFmtIdx; ui.pieLabelFmt = pieLabelFmt;

            // 引导线
            var llPanel = page.add("panel", undefined, "引导线 labelLine（仅「外部」位置生效）");
            llPanel.orientation = "column"; llPanel.alignChildren = ["fill", "top"]; llPanel.spacing = 3; llPanel.margins = 8;

            var llCheck = llPanel.add("checkbox", undefined, "显示引导线");
            llCheck.value = state.pieLabelLineShow; ui.pieLabelLineCheck = llCheck;
        }

        // === 页面切换 ===
        function switchTo(pageName) {
            captureValues();
            clearContent();
            if (pageName === 'basic') buildBasicPage();
            else if (pageName === 'axis') buildAxisPage();
            else if (pageName === 'data') buildDataPage();
            else if (pageName === 'pie') buildPiePage();
            else if (pageName === 'bar') buildBarStylePage();
            else if (pageName === 'barAdv') buildBarAdvPage();
            else buildLineStylePage();
            try { win.layout.layout(true); } catch (e) {}
        }

        navBtnBasic.onClick = function () { switchTo('basic'); };
        navBtnAxis.onClick = function () { switchTo('axis'); };
        navBtnData.onClick = function () { switchTo('data'); };
        navBtnBar.onClick = function () { switchTo('bar'); };
        navBtnLine.onClick = function () { switchTo('line'); };
        navBtnBarAdv.onClick = function () { switchTo('barAdv'); };
        navBtnPie.onClick = function () { switchTo('pie'); };

        // === 配置收集 ===
        function collectConfig() {
            captureValues();
            var tp = CHART_TYPES[state.chartTypeIdx] || CHART_TYPES[0];
            var seriesCount = Math.max(1, Math.min(5, parseInt(state.seriesCount) || 1));
            var seriesList = [];
            for (var s = 0; s < seriesCount; s++) {
                var src = state.series[s] || { name: "测试数据" + String.fromCharCode(65 + s), data: "10,20,30,40,50" };
                seriesList.push({ name: src.name || ("测试数据" + String.fromCharCode(65 + s)), data: parseNumberList(src.data) });
            }
            var lineTypeMap = ['solid', 'dashed', 'dotted'];
            var config = {
                chartType: tp.type, chartSubtype: tp.sub,
                title: { show: state.titleShow, text: state.titleText, subtext: state.subTitleText,
                    left: ['left','center','right'][state.titlePosIdx],
                    textStyle: { color: state.titleColor, fontSize: numInput(state.titleSize, 48) },
                    subtextStyle: { color: state.subColor, fontSize: numInput(state.subSize, 31) } },
                grid: { left: numInput(state.gridLeft, 160), right: numInput(state.gridRight, 180),
                    top: numInput(state.gridTop, 180), bottom: numInput(state.gridBottom, 160) },
                xAxis: { show: state.xShow, name: state.xName, axisLineColor: state.xLineColor,
                    axisLineWidth: numInput(state.xLineW, 5), labelColor: state.xLabelColor,
                    labelFontSize: numInput(state.xLabelSize, 31), splitLine: { show: state.xSplit, color: state.xSplitColor } },
                yAxis: { show: state.yShow, name: state.yName, axisLineColor: state.yLineColor,
                    axisLineWidth: numInput(state.yLineW, 5), labelColor: state.yLabelColor,
                    labelFontSize: numInput(state.yLabelSize, 31), tickCount: numInput(state.yTickCount, 6),
                    suffix: state.ySuffix, rightSuffix: state.yRightSuffix,
                    splitLine: { show: state.ySplit, color: state.ySplitColor } },
                legend: { show: state.legendShow, position: ['top','bottom','left','right'][state.legendPosIdx],
                    textColor: state.legendTextColor, fontSize: numInput(state.legendSize, 31) },
                label: { show: state.labelShow, position: ['top','inside','bottom'][state.labelPosIdx],
                    color: state.labelColor, fontSize: numInput(state.labelSize, 33), percent: state.labelPercent },
                barStyle: { width: state.barWidth, maxWidth: numInput(state.barMaxW, 0),
                    minHeight: numInput(state.barMinH, 2), borderRadius: numInput(state.barRadius, 8),
                    borderColor: state.barBorderColor, borderWidth: numInput(state.barBorderW, 0),
                    opacity: numInput(state.barOpacity, 100), showBackground: state.barBgShow,
                    backgroundColor: state.barBgColor, backgroundOpacity: numInput(state.barBgOpacity, 40),
                    showZeroLine: state.negShowZeroLine, zeroLineColor: state.negZeroColor,
                    waterfallConnector: state.waterfallConnector,
                    waterfallConnectorColor: state.waterfallConnectorColor,
                    stackLabelPercent: (state.stackLabelFmtIdx === 0) },
                lineStyle: { width: numInput(state.lineW, 5), type: lineTypeMap[state.lineTypeIdx],
                    smooth: state.lineSmooth, showSymbol: state.lineSymbol, symbolCycle: state.symbolCycle,
                    symbolType: SYMBOL_TYPES[state.symbolTypeIdx] || 'circle',
                    symbolSize: numInput(state.symbolSize, 18), symbolBorderColor: state.symbolBorderColor,
                    symbolBorderWidth: numInput(state.symbolBorderW, 3), area: state.areaCheck,
                    areaColor: state.areaColor, areaOpacity: numInput(state.areaOpacity, 50),
                    gradient: (tp.sub === 'gradientArea'),
                    gradTop: state.gradAreaTop, gradBottom: state.gradAreaBottom,
                    gradOpacity: numInput(state.gradAreaOpacity, 70) },
                pie: {
                    innerR: Math.max(0, Math.min(95, numInput(state.pieInnerR, 0))),
                    outerR: Math.max(1, Math.min(100, numInput(state.pieOuterR, 75))),
                    startAngle: numInput(state.pieStartAngle, 90),
                    endAngle: (String(state.pieEndAngle).replace(/\s/g, '') === '') ? null : numInput(state.pieEndAngle, 360),
                    clockwise: state.pieClockwise,
                    padAngle: Math.max(0, numInput(state.piePadAngle, 0)),
                    roseType: ROSE_MODES[state.pieRoseTypeIdx] || 'none',
                    minAngle: Math.max(0, numInput(state.pieMinAngle, 0)),
                    borderRadius: Math.max(0, numInput(state.pieRadius, 0)),
                    borderColor: state.pieBorderColor, borderWidth: numInput(state.pieBorderW, 2),
                    labelPos: ['outside', 'inside', 'center'][state.pieLabelPosIdx] || 'outside',
                    labelFmt: ['value', 'percent', 'name', 'nameValue', 'namePercent'][state.pieLabelFmtIdx] || 'value',
                    labelRadius: numInput(state.pieLabelRadius, 0.65),
                    labelLine: { show: state.pieLabelLineShow, length: Math.max(0, numInput(state.pieLabelLineLen, 15)),
                                 length2: Math.max(0, numInput(state.pieLabelLineLen2, 15)), smooth: state.pieLabelLineSmooth }
                },
                seriesList: seriesList, labels: parseStringList(state.labels),
                legendLabels: [], color: parseStringList(state.colorInput),
                animation: { duration: numInput(state.animInput, 1.2), stagger: numInput(state.staggerInput, 0.08) }
            };
            if (config.pie.innerR >= config.pie.outerR) config.pie.innerR = Math.max(0, config.pie.outerR - 5);
            if (isPieType(tp.sub)) config.legendLabels = config.labels.slice();
            else for (var q = 0; q < seriesList.length; q++) config.legendLabels.push(seriesList[q].name);
            return config;
        }

        generateBtn.onClick = function () {
            var config = collectConfig();
            if (!config.seriesList || config.seriesList.length === 0 || config.seriesList[0].data.length === 0) {
                alert("请输入至少一个数据值。"); return;
            }
            app.beginUndoGroup("生成图表");
            try { generateChart(config); }
            catch (e) { alert("生成图表出错: " + e.toString() + "\n(行 " + (e.line || "?") + ")"); }
            app.endUndoGroup();
        };
        closeBtn.onClick = function () { if (win instanceof Window) win.close(); };

        buildBasicPage();
        return win;
    }

    // ============ 生成图表 ============
    function generateChart(config) {
        var baseName = config.title.show && config.title.text ? sanitizeCompName(config.title.text) : "图表合成";
        if (!baseName) baseName = "图表合成";
        var comp = findCompByName(baseName);
        if (comp) clearAutoLayers(comp);
        else comp = app.project.items.addComp(baseName, 1920, 1080, 1, 10, 30);
        var needDur = config.animation.duration + config.animation.stagger * 3 + 1.2;
        if (comp.duration < needDur) comp.duration = needDur;
        try { comp.openInViewer(); } catch (e) {}

        var W = comp.width, H = comp.height;
        var g = config.grid;
        var totalValue = 0;
        for (var ti = 0; ti < config.seriesList.length; ti++)
            for (var tj = 0; tj < config.seriesList[ti].data.length; tj++)
                totalValue += config.seriesList[ti].data[tj];
        config._total = totalValue;

        var legend = null;
        var legendGap = Math.round(config.legend.fontSize * 0.7);
        if (config.legend.show) legend = computeLegendLayout(comp, config);
        var chartLeft = g.left, chartRight = W - g.right;
        var chartTop = g.top, chartBottom = H - g.bottom;
        var legendCenterX = 0, legendCenterY = 0;
        var titleY = Math.max(config.title.textStyle.fontSize * 0.9, g.top * 0.3);

        if (legend) {
            var pos = config.legend.position;
            if (pos === 'top') {
                var titleBlockH = 0;
                if (config.title.show) { titleBlockH = config.title.textStyle.fontSize * 1.15; if (config.title.subtext) titleBlockH += config.title.subtextStyle.fontSize * 1.15 + 8; }
                var topStart = 20; titleY = topStart + titleBlockH / 2;
                var legendStartY = topStart + titleBlockH + legendGap;
                legendCenterY = legendStartY + legend.boxW / 2; legendCenterX = W / 2;
                var newTop = legendStartY + legend.boxW + legendGap;
                if (newTop > chartTop) chartTop = newTop;
            } else if (pos === 'bottom') {
                var neededB = legend.boxW + 2 * legendGap;
                if (g.bottom >= neededB) { legendCenterY = H - g.bottom / 2; chartBottom = H - g.bottom; }
                else { chartBottom = H - neededB; legendCenterY = H - legendGap - legend.boxW / 2; }
                legendCenterX = W / 2;
            } else if (pos === 'left') {
                var neededL = legend.verticalW + 2 * legendGap;
                if (g.left >= neededL) { legendCenterX = g.left / 2; chartLeft = g.left; }
                else { chartLeft = neededL; legendCenterX = legendGap + legend.verticalW / 2; }
                legendCenterY = chartTop + (chartBottom - chartTop) / 2;
            } else if (pos === 'right') {
                var neededR = legend.verticalW + 2 * legendGap;
                if (g.right >= neededR) { legendCenterX = W - g.right / 2; chartRight = W - g.right; }
                else { chartRight = W - neededR; legendCenterX = W - legendGap - legend.verticalW / 2; }
                legendCenterY = chartTop + (chartBottom - chartTop) / 2;
            }
        }

        var chartW = chartRight - chartLeft, chartH = chartBottom - chartTop;
        if (chartW < 50) chartW = 50;
        if (chartH < 50) chartH = 50;
        var leftX = chartLeft, baseY = chartBottom;
        var seriesList = config.seriesList, labels = config.labels, sub = config.chartSubtype;

        if (config.title.show) {
            var titleX = config.title.left === 'left' ? g.left : config.title.left === 'right' ? W - g.right : W / 2;
            drawTitle(comp, config, titleX, titleY);
        }
        if (legend) drawLegend(comp, config, legend, legendCenterX, legendCenterY);

        if (isPieType(sub)) {
            var pcx = (chartLeft + chartRight) / 2, pcy = (chartTop + chartBottom) / 2;
            var pRadius = Math.min(chartW, chartH) * 0.42;
            drawPieChart(comp, config, pcx, pcy, pRadius, seriesList[0].data, labels);
            comp.time = 0; return;
        }

        var maxValue = 0, minValue = 0;
        // 累加型（堆叠柱/堆叠折线/堆叠面积/水平堆叠）必须按「各分类累计和」定坐标轴上限，
        // 否则多条系列累加后会冲出绘图区（曾出现折线上方越界、横向条超出右边界）
        if (sub === 'stacked' || sub === 'stackedArea' || sub === 'stackedNorm' || sub === 'stackedLine' || sub === 'horizontalStacked') {
            var n = labels.length;
            for (var i = 0; i < n; i++) {
                var sum = 0;
                for (var s = 0; s < seriesList.length; s++) sum += seriesList[s].data[i] || 0;
                if (sum > maxValue) maxValue = sum;
                if (sum < minValue) minValue = sum;
            }
        } else if (sub === 'dualAxis') {
            maxValue = Math.max.apply(null, seriesList[0].data);
            minValue = Math.min.apply(null, seriesList[0].data);
        } else if (sub === 'barLine') {
            for (var s2 = 0; s2 < seriesList.length; s2++) { var m = Math.max.apply(null, seriesList[s2].data); if (m > maxValue) maxValue = m; var mi = Math.min.apply(null, seriesList[s2].data); if (mi < minValue) minValue = mi; }
        } else if (sub === 'negative' || sub === 'waterfall') {
            // 正负值 / 瀑布：需要正负两侧范围（瀑布按累计过程中的极值）
            if (sub === 'waterfall') {
                var run = 0;
                for (var wi = 0; wi < seriesList[0].data.length; wi++) {
                    run += seriesList[0].data[wi] || 0;
                    if (run > maxValue) maxValue = run;
                    if (run < minValue) minValue = run;
                }
                if (maxValue < 0) maxValue = 0;
            } else {
                for (var s4 = 0; s4 < seriesList.length; s4++) {
                    var mx = Math.max.apply(null, seriesList[s4].data); if (mx > maxValue) maxValue = mx;
                    var mn = Math.min.apply(null, seriesList[s4].data); if (mn < minValue) minValue = mn;
                }
            }
        } else {
            for (var s3 = 0; s3 < seriesList.length; s3++) { var m2 = Math.max.apply(null, seriesList[s3].data); if (m2 > maxValue) maxValue = m2; var m3 = Math.min.apply(null, seriesList[s3].data); if (m3 < minValue) minValue = m3; }
        }
        var axis = (minValue < 0) ? calculateTicksSigned(maxValue, minValue, config.yAxis.tickCount)
                                  : calculateTicks(maxValue, config.yAxis.tickCount);

        if (sub === 'basic' && config.chartType === 'bar') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawBarChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels);
        } else if (sub === 'grouped') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawGroupedBarChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels);
        } else if (sub === 'stacked') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawStackedBarChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels);
        } else if (sub === 'stackedNorm') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, calculateTicks(100, config.yAxis.tickCount), labels);
            drawStackedNormChart(comp, config, leftX, baseY, chartW, chartH, seriesList, labels);
        } else if (sub === 'horizontal') {
            drawHorizontalChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels);
        } else if (sub === 'horizontalStacked') {
            drawHorizontalStackedChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels);
        } else if (sub === 'negative') {
            drawNegativeAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawNegativeBarChart(comp, config, leftX, baseY, chartW, chartH, axis, seriesList[0].data, labels);
        } else if (sub === 'waterfall') {
            drawNegativeAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawWaterfallChart(comp, config, leftX, baseY, chartW, chartH, axis, seriesList[0].data, labels);
        } else if (sub === 'basic' && config.chartType === 'line') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels, { mode: 'basic' });
        } else if (sub === 'smooth') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels, { mode: 'smooth' });
        } else if (sub === 'area') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels, { mode: 'area' });
        } else if (sub === 'gradientArea') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels, { mode: 'gradientArea' });
        } else if (sub === 'stackedLine') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawStackedLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels);
        } else if (sub === 'stackedArea') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawStackedAreaChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels);
        } else if (sub === 'step') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawLineChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList[0].data, labels, { mode: 'step' });
        } else if (sub === 'barLine') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawComboChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels, false);
        } else if (sub === 'dualAxis') {
            drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels);
            drawComboChart(comp, config, leftX, baseY, chartW, chartH, axis.max, seriesList, labels, true);
        }
        comp.time = 0;
    }

    // ============ 绘制函数 ============
    function drawTitle(comp, config, posX, baseY) {
        var dur = config.animation.duration;
        if (config.title.text) {
            var t = addTextLayer(comp, config.title.text, "标题");
            setTextDoc(t, config.title.textStyle.fontSize, config.title.textStyle.color, ParagraphJustification.CENTER_JUSTIFY);
            t.property("ADBE Transform Group").property("ADBE Position").setValue([posX, baseY]);
            applyTextEnter(t, dur * 0.8, 0, 0, -60);
        }
        if (config.title.subtext) {
            var s = addTextLayer(comp, config.title.subtext, "副标题");
            setTextDoc(s, config.title.subtextStyle.fontSize, config.title.subtextStyle.color, ParagraphJustification.CENTER_JUSTIFY);
            s.property("ADBE Transform Group").property("ADBE Position").setValue([posX, baseY + config.title.textStyle.fontSize * 0.75 + config.title.subtextStyle.fontSize * 0.6]);
            applyTextEnter(s, dur * 0.8, 0.12, 0, -50);
        }
    }

    function drawLegend(comp, config, L, centerX, centerY) {
        var pos = config.legend.position, fontSize = config.legend.fontSize, n = L.n;
        var vertical = (pos === 'left' || pos === 'right'), dur = config.animation.duration;
        var startX, startY;
        if (vertical) { startX = centerX - L.verticalW / 2; startY = centerY - L.verticalH / 2 + L.itemH / 2; }
        else { startX = centerX - L.horizontalW / 2; startY = centerY; }
        for (var j = 0; j < n; j++) {
            var cx, cy;
            if (vertical) { cx = startX + L.boxW / 2; cy = startY + j * L.itemH; }
            else { cx = startX + j * (L.boxW + L.gapBlock + L.maxTextW + L.gapItem) + L.boxW / 2; cy = startY; }
            var bl = addShapeLayer(comp, "图例色块_" + j); setLayerOrigin(bl);
            var bR = bl.property("ADBE Root Vectors Group");
            var bG = bR.addProperty("ADBE Vector Group");
            var bV = bG.property("ADBE Vectors Group");
            var bRect = bV.addProperty("ADBE Vector Shape - Rect");
            bRect.property("ADBE Vector Rect Size").setValue([L.boxW, L.boxW]);
            bRect.property("ADBE Vector Rect Roundness").setValue(Math.round(L.boxW * 0.2));
            var bF = bV.addProperty("ADBE Vector Graphic - Fill");
            bF.property("ADBE Vector Fill Color").setValue(hexToRgb(L.colors[j % L.colors.length]));
            var bT = bG.property("ADBE Vector Transform Group");
            bT.property("ADBE Vector Position").setValue([cx, cy]);
            var bLayerTf = bl.property("ADBE Transform Group");
            applyLabelPop(bLayerTf.property("ADBE Scale"), bLayerTf.property("ADBE Opacity"), dur * 0.5, 0.18 + j * 0.05);
            var tl = addTextLayer(comp, L.labels[j], "图例文字_" + j);
            setTextDoc(tl, fontSize, config.legend.textColor, ParagraphJustification.LEFT_JUSTIFY);
            placeText(tl, cx + L.boxW / 2 + L.gapBlock, cy, 'left');
            applyTextEnter(tl, dur * 0.5, 0.22 + j * 0.05, 20, 0);
        }
    }

    // 饼图系：基础饼图 / 环形图 / 半环形图 / 南丁格尔玫瑰图 / 圆角环形图 / 扇区间隙
    // 支持内-外半径、起止角、顺时针、padAngle、roseType、minAngle、几何圆角 borderRadius、
    // 标签位置(外部带引导线 / 扇区内 / 圆心合计) 与标签文本格式
    function drawPieChart(comp, config, cx, cy, availRadius, values, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = values.length;
        if (n === 0) return;
        var pc = config.pie, label = config.label;
        var duration = config.animation.duration, stagger = config.animation.stagger;
        var lay = computePieLayout(values, pc, availRadius);
        if (lay.total <= 0) return;
        // 半环/局部扇形自动居中
        var off = computePieBBoxOffset(lay.items, pc);
        cx = cx - off[0]; cy = cy - off[1];

        var k, it, iv;
        for (k = 0; k < lay.items.length; k++) {
            it = lay.items[k];
            if (it.span <= 0.0005) continue;
            var verts = buildPieSectorVerts(it, pc, cx, cy);
            if (verts.length < 3) continue;
            var inT = [], outT = [];
            for (iv = 0; iv < verts.length; iv++) { inT.push([0, 0]); outT.push([0, 0]); }
            var colorHex = colors[k % colors.length];
            var pieLayer = addShapeLayer(comp, "扇形_" + (labels[k] || k));
            setLayerOrigin(pieLayer);
            var root = pieLayer.property("ADBE Root Vectors Group");
            var group = root.addProperty("ADBE Vector Group");
            var vectors = group.property("ADBE Vectors Group");
            var pathGroup = vectors.addProperty("ADBE Vector Shape - Group");
            var shape = new Shape();
            shape.vertices = verts; shape.inTangents = inT; shape.outTangents = outT; shape.closed = true;
            pathGroup.property("ADBE Vector Shape").setValue(shape);
            var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
            fill.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            if (pc.borderWidth > 0) {
                var stroke = vectors.addProperty("ADBE Vector Graphic - Stroke");
                stroke.property("ADBE Vector Stroke Color").setValue(hexToRgb(pc.borderColor));
                stroke.property("ADBE Vector Stroke Width").setValue(pc.borderWidth);
                stroke.property("ADBE Vector Stroke Line Join").setValue(2);
            }
            var tf = group.property("ADBE Vector Transform Group");
            tf.property("ADBE Vector Anchor").setValue([cx, cy]);
            tf.property("ADBE Vector Position").setValue([cx, cy]);
            applyElasticScale(tf.property("ADBE Vector Scale"), duration * 0.6, 0.15 + k * stagger);
        }

        if (!label.show) return;

        // 圆心合计（环形图常用：洞里面一个大数字）
        if (pc.labelPos === 'center') {
            var cLayer = addTextLayer(comp, String(lay.total), "中心合计");
            setTextDoc(cLayer, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
            placeText(cLayer, cx, cy, 'center');
            var cTf = cLayer.property("ADBE Transform Group");
            applyLabelPop(cTf.property("ADBE Scale"), cTf.property("ADBE Opacity"), duration * 0.5, 0.3);
            return;
        }

        for (k = 0; k < lay.items.length; k++) {
            it = lay.items[k];
            if (it.span <= 0.0005) continue;
            var lname = (labels[k] === undefined || labels[k] === null) ? k : labels[k];
            var text = fmtPieLabel(pc.labelFmt, lname, it.value, lay.total);

            if (pc.labelPos === 'inside') {
                var labelR = it.rIn + (it.rOut - it.rIn) * pc.labelRadius;
                var iLayer = addTextLayer(comp, text, "值_" + lname);
                setTextDoc(iLayer, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(iLayer, cx + Math.cos(it.mid) * labelR, cy + Math.sin(it.mid) * labelR, 'center');
                var iTf = iLayer.property("ADBE Transform Group");
                applyLabelPop(iTf.property("ADBE Scale"), iTf.property("ADBE Opacity"), duration * 0.5, 0.3 + k * stagger);
                continue;
            }

            // 外部：引导线两段折线 + 左右对齐
            var LL = pc.labelLine;
            var dirX = Math.cos(it.mid) >= 0 ? 1 : -1;
            var anchorX, anchorY;
            if (LL.show) {
                var lineRes = LL.smooth ? buildLabelLineSmoothPts(cx, cy, it.rOut, it.mid, LL.length, LL.length2)
                                        : buildLabelLinePts(cx, cy, it.rOut, it.mid, LL.length, LL.length2);
                var llLayer = addShapeLayer(comp, "引导线_" + lname);
                setLayerOrigin(llLayer);
                var llRoot = llLayer.property("ADBE Root Vectors Group");
                var llP = llRoot.addProperty("ADBE Vector Shape - Group");
                var llS = new Shape();
                llS.vertices = lineRes.pts; llS.closed = false;
                llP.property("ADBE Vector Shape").setValue(llS);
                var llStk = llRoot.addProperty("ADBE Vector Graphic - Stroke");
                llStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(colors[k % colors.length]));
                llStk.property("ADBE Vector Stroke Width").setValue(Math.max(1, Math.round(label.fontSize * 0.06)));
                llStk.property("ADBE Vector Stroke Line Cap").setValue(2);
                var llT = llRoot.addProperty("ADBE Vector Filter - Trim");
                applyEaseOutTrim(llT.property("ADBE Vector Trim End"), duration * 0.5, 0.25 + k * stagger);
                anchorX = lineRes.end[0]; anchorY = lineRes.end[1];
            } else {
                anchorX = cx + Math.cos(it.mid) * (it.rOut + label.fontSize * 0.6);
                anchorY = cy + Math.sin(it.mid) * (it.rOut + label.fontSize * 0.6);
            }
            var oLayer = addTextLayer(comp, text, "值_" + lname);
            setTextDoc(oLayer, label.fontSize, label.color,
                       dirX > 0 ? ParagraphJustification.LEFT_JUSTIFY : ParagraphJustification.RIGHT_JUSTIFY);
            placeText(oLayer, anchorX + dirX * label.fontSize * 0.35, anchorY, dirX > 0 ? 'left' : 'right');
            var oTf = oLayer.property("ADBE Transform Group");
            applyLabelPop(oTf.property("ADBE Scale"), oTf.property("ADBE Opacity"), duration * 0.5, 0.3 + k * stagger);
        }
    }

    function drawAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels) {
        var xc = config.xAxis, yc = config.yAxis;
        var dur = config.animation.duration;
        var isDual = (config.chartSubtype === 'dualAxis');
        var suffix = yc.suffix || "";
        var leftAxisColor = yc.axisLineColor, leftAxisLabelColor = yc.labelColor;
        if (isDual && config.color && config.color.length > 0) { leftAxisColor = config.color[0]; leftAxisLabelColor = config.color[0]; }
        if (yc.show) {
            var yl = addShapeLayer(comp, "Y轴"); setLayerOrigin(yl);
            var yP = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var yS = new Shape(); yS.vertices = [[leftX, baseY], [leftX, baseY - chartH]]; yS.closed = false;
            yP.property("ADBE Vector Shape").setValue(yS);
            var yStk = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            yStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(leftAxisColor));
            yStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
            yStk.property("ADBE Vector Stroke Line Cap").setValue(2);
            var yT = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
            applyEaseOutTrim(yT.property("ADBE Vector Trim End"), dur * 0.6, 0.05);
        }
        if (xc.show) {
            var xl = addShapeLayer(comp, "X轴"); setLayerOrigin(xl);
            var xP = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var xS = new Shape(); xS.vertices = [[leftX, baseY], [leftX + chartW, baseY]]; xS.closed = false;
            xP.property("ADBE Vector Shape").setValue(xS);
            var xStk = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            xStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(xc.axisLineColor));
            xStk.property("ADBE Vector Stroke Width").setValue(xc.axisLineWidth);
            xStk.property("ADBE Vector Stroke Line Cap").setValue(2);
            var xT = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
            applyEaseOutTrim(xT.property("ADBE Vector Trim End"), dur * 0.6, 0.15);
        }
        var ticks = axis.ticks;
        for (var i = 0; i < ticks.length; i++) {
            var val = ticks[i];
            var y = baseY - (val / axis.max) * chartH;
            if (yc.splitLine.show && yc.show && val > 0.0001) {
                var sl = addShapeLayer(comp, "Y分割线_" + val); setLayerOrigin(sl);
                var slP = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var slS = new Shape(); slS.vertices = [[leftX, y], [leftX + chartW, y]]; slS.closed = false;
                slP.property("ADBE Vector Shape").setValue(slS);
                var slStk = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                slStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(yc.splitLine.color));
                slStk.property("ADBE Vector Stroke Width").setValue(2);
                var slT = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
                applyEaseOutTrim(slT.property("ADBE Vector Trim End"), dur * 0.5, 0.2 + i * 0.04);
            }
            if (yc.show) {
                var tk = addShapeLayer(comp, "Y刻度_" + val); setLayerOrigin(tk);
                var tP = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var tS = new Shape(); tS.vertices = [[leftX - 8, y], [leftX, y]]; tS.closed = false;
                tP.property("ADBE Vector Shape").setValue(tS);
                var tStk = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                tStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(leftAxisColor));
                tStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
                var numL = addTextLayer(comp, String(val) + suffix, "Y标签_" + val);
                setTextDoc(numL, yc.labelFontSize, leftAxisLabelColor, ParagraphJustification.RIGHT_JUSTIFY);
                placeText(numL, leftX - 20, y, 'right');
                applyTextEnter(numL, dur * 0.45, 0.25 + i * 0.04, -25, 0);
            }
        }
        var n = labels.length; if (n === 0) n = 1;
        var slotW = chartW / n;
        var useSlotCenter = (config.chartType === 'bar' && config.chartSubtype !== 'horizontal') || config.chartType === 'combo';
        for (var j = 0; j < labels.length; j++) {
            var x = useSlotCenter ? leftX + slotW * (j + 0.5) : leftX + (chartW / Math.max(n - 1, 1)) * j;
            if (xc.splitLine.show && xc.show && Math.abs(x - leftX) > 2) {
                var vs = addShapeLayer(comp, "X分割线_" + j); setLayerOrigin(vs);
                var vsP = vs.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var vsS = new Shape(); vsS.vertices = [[x, baseY], [x, baseY - chartH]]; vsS.closed = false;
                vsP.property("ADBE Vector Shape").setValue(vsS);
                var vsStk = vs.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                vsStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(xc.splitLine.color));
                vsStk.property("ADBE Vector Stroke Width").setValue(2);
            }
            if (xc.show) {
                var xL = addTextLayer(comp, labels[j], "X标签_" + labels[j]);
                setTextDoc(xL, xc.labelFontSize, xc.labelColor, ParagraphJustification.CENTER_JUSTIFY);
                placeText(xL, x, baseY + xc.labelFontSize * 0.5 + 22, 'center');
                applyTextEnter(xL, dur * 0.45, 0.3 + j * 0.05, 0, 25);
            }
        }
        if (xc.show && xc.name) {
            var xn = addTextLayer(comp, xc.name, "X轴名称");
            setTextDoc(xn, xc.labelFontSize + 4, xc.labelColor, ParagraphJustification.CENTER_JUSTIFY);
            placeText(xn, leftX + chartW / 2, baseY + xc.labelFontSize + 70, 'center');
            applyTextEnter(xn, dur * 0.6, 0.4, 0, 30);
        }
        var leftAxisName = yc.name;
        if (isDual && config.seriesList[0] && config.seriesList[0].name) leftAxisName = config.seriesList[0].name;
        if (yc.show && leftAxisName) {
            var yn = addTextLayer(comp, leftAxisName, "Y轴名称");
            var yNameSize = isDual ? Math.max(yc.labelFontSize - 4, 20) : (yc.labelFontSize + 4);
            setTextDoc(yn, yNameSize, leftAxisLabelColor, ParagraphJustification.CENTER_JUSTIFY);
            if (isDual) { placeText(yn, leftX, baseY - chartH - yc.labelFontSize * 1.2, 'center'); applyTextEnter(yn, dur * 0.6, 0.4, 0, -20); }
            else { placeText(yn, leftX - yc.labelFontSize * 3 - 20, baseY - chartH / 2, 'center'); applyTextEnter(yn, dur * 0.6, 0.4, -30, 0); }
        }
    }

    // 正负值/瀑布图专用坐标轴：Y 轴刻度含负值，0 轴基准线加粗强调
    function drawNegativeAxes(comp, config, leftX, baseY, chartW, chartH, axis, labels) {
        var xc = config.xAxis, yc = config.yAxis;
        var dur = config.animation.duration;
        var suffix = yc.suffix || "";
        var axisMin = axis.min, axisMax = axis.max, span = axisMax - axisMin;
        if (span <= 0) span = 1;
        var zeroY = baseY - (0 - axisMin) / span * chartH;

        if (yc.show) {
            var yl = addShapeLayer(comp, "Y轴"); setLayerOrigin(yl);
            var yP = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var yS = new Shape(); yS.vertices = [[leftX, baseY], [leftX, baseY - chartH]]; yS.closed = false;
            yP.property("ADBE Vector Shape").setValue(yS);
            var yStk = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            yStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(yc.axisLineColor));
            yStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
            yStk.property("ADBE Vector Stroke Line Cap").setValue(2);
        }
        if (xc.show) {
            var xl = addShapeLayer(comp, "X轴"); setLayerOrigin(xl);
            var xP = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var xS = new Shape(); xS.vertices = [[leftX, baseY], [leftX + chartW, baseY]]; xS.closed = false;
            xP.property("ADBE Vector Shape").setValue(xS);
            var xStk = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            xStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(xc.axisLineColor));
            xStk.property("ADBE Vector Stroke Width").setValue(xc.axisLineWidth);
        }
        var ticks = axis.ticks;
        for (var i = 0; i < ticks.length; i++) {
            var val = ticks[i];
            var y = baseY - (val - axisMin) / span * chartH;
            if (yc.splitLine.show && yc.show && Math.abs(val) > 0.0001) {
                var sl = addShapeLayer(comp, "Y分割线_" + val); setLayerOrigin(sl);
                var slP = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var slS = new Shape(); slS.vertices = [[leftX, y], [leftX + chartW, y]]; slS.closed = false;
                slP.property("ADBE Vector Shape").setValue(slS);
                var slStk = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                slStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(yc.splitLine.color));
                slStk.property("ADBE Vector Stroke Width").setValue(2);
            }
            if (yc.show) {
                var tk = addShapeLayer(comp, "Y刻度_" + val); setLayerOrigin(tk);
                var tP = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var tS = new Shape(); tS.vertices = [[leftX - 8, y], [leftX, y]]; tS.closed = false;
                tP.property("ADBE Vector Shape").setValue(tS);
                var tStk = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                tStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(yc.axisLineColor));
                tStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
                var numL = addTextLayer(comp, String(val) + suffix, "Y标签_" + val);
                setTextDoc(numL, yc.labelFontSize, yc.labelColor, ParagraphJustification.RIGHT_JUSTIFY);
                placeText(numL, leftX - 20, y, 'right');
                applyTextEnter(numL, dur * 0.45, 0.25 + i * 0.04, -25, 0);
            }
        }
        // 0 轴基准线（正负分界）
        if (config.barStyle.showZeroLine && axisMin < 0 && axisMax > 0) {
            var zl = addShapeLayer(comp, "0轴基准线"); setLayerOrigin(zl);
            var zP = zl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var zS = new Shape(); zS.vertices = [[leftX, zeroY], [leftX + chartW, zeroY]]; zS.closed = false;
            zP.property("ADBE Vector Shape").setValue(zS);
            var zStk = zl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            zStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.barStyle.zeroLineColor));
            zStk.property("ADBE Vector Stroke Width").setValue(Math.max(2, yc.axisLineWidth * 0.6));
            applyEaseOutTrim(zl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim").property("ADBE Vector Trim End"), dur * 0.6, 0.1);
        }
        var n = labels.length; if (n === 0) n = 1;
        var slotW = chartW / n;
        for (var j = 0; j < labels.length; j++) {
            if (xc.show) {
                var xL = addTextLayer(comp, labels[j], "X标签_" + labels[j]);
                setTextDoc(xL, xc.labelFontSize, xc.labelColor, ParagraphJustification.CENTER_JUSTIFY);
                placeText(xL, leftX + slotW * (j + 0.5), baseY + xc.labelFontSize * 0.5 + 22, 'center');
                applyTextEnter(xL, dur * 0.45, 0.3 + j * 0.05, 0, 25);
            }
        }
        if (yc.show && yc.name) {
            var yn = addTextLayer(comp, yc.name, "Y轴名称");
            setTextDoc(yn, yc.labelFontSize + 4, yc.labelColor, ParagraphJustification.CENTER_JUSTIFY);
            placeText(yn, leftX - yc.labelFontSize * 3 - 20, baseY - chartH / 2, 'center');
            applyTextEnter(yn, dur * 0.6, 0.4, -30, 0);
        }
    }

    function addBarBackground(comp, cx, cy, barW, chartH, radius, bs, name) {
        if (!bs.showBackground) return;
        var bg = addShapeLayer(comp, name || "柱背景");
        setLayerOrigin(bg);
        var bgR = bg.property("ADBE Root Vectors Group");
        var bgG = bgR.addProperty("ADBE Vector Group");
        var bgV = bgG.property("ADBE Vectors Group");
        var bgRect = bgV.addProperty("ADBE Vector Shape - Rect");
        bgRect.property("ADBE Vector Rect Size").setValue([barW, chartH]);
        bgRect.property("ADBE Vector Rect Position").setValue([0, -chartH / 2]);
        bgRect.property("ADBE Vector Rect Roundness").setValue(Math.min(radius, barW / 2, chartH / 2));
        var bgF = bgV.addProperty("ADBE Vector Graphic - Fill");
        bgF.property("ADBE Vector Fill Color").setValue(hexToRgb(bs.backgroundColor));
        var bgT = bgG.property("ADBE Vector Transform Group");
        bgT.property("ADBE Vector Anchor").setValue([0, 0]);
        bgT.property("ADBE Vector Position").setValue([cx, cy]);
        bg.property("ADBE Transform Group").property("ADBE Opacity").setValue(bs.backgroundOpacity);
    }

    function drawBarChart(comp, config, leftX, baseY, chartW, chartH, axisMax, values, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = values.length; if (n === 0) return;
        var slotW = chartW / n;
        var barW = parseSize(config.barStyle.width, slotW);
        if (config.barStyle.maxWidth > 0) barW = Math.min(barW, config.barStyle.maxWidth);
        barW = Math.min(barW, slotW * 0.95); if (barW < 2) barW = 2;
        var duration = config.animation.duration, stagger = config.animation.stagger;
        var bs = config.barStyle, label = config.label;
        for (var bgi = 0; bgi < n; bgi++) addBarBackground(comp, leftX + slotW * (bgi + 0.5), baseY, barW, chartH, bs.borderRadius, bs, "柱背景_" + bgi);
        for (var i = 0; i < n; i++) {
            var value = values[i];
            var h = Math.max((value / axisMax) * chartH, bs.minHeight);
            var cx = leftX + slotW * (i + 0.5);
            var colorHex = getColorByData(colors, i);
            var delay = 0.25 + i * stagger;
            var bl = addShapeLayer(comp, "柱_" + i); setLayerOrigin(bl);
            var root = bl.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            var v = g.property("ADBE Vectors Group");
            var r = v.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue([barW, h]);
            r.property("ADBE Vector Rect Position").setValue([0, -h / 2]);
            r.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, barW / 2, h / 2));
            var f = v.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            if (bs.borderWidth > 0) {
                var sk = v.addProperty("ADBE Vector Graphic - Stroke");
                sk.property("ADBE Vector Stroke Color").setValue(hexToRgb(bs.borderColor));
                sk.property("ADBE Vector Stroke Width").setValue(bs.borderWidth);
            }
            var tf = g.property("ADBE Vector Transform Group");
            tf.property("ADBE Vector Anchor").setValue([0, 0]);
            tf.property("ADBE Vector Position").setValue([cx, baseY]);
            applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
            if (bs.opacity < 100) bl.property("ADBE Transform Group").property("ADBE Opacity").setValue(bs.opacity);
            if (label.show) {
                var lY = computeBarLabelY(label.position, baseY, baseY - h, h, label.fontSize, false);
                var vL = addTextLayer(comp, fmtValue(value, label, config._total), "值_" + i);
                setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL, cx, lY, 'center');
                var vTf = vL.property("ADBE Transform Group");
                applyLabelPop(vTf.property("ADBE Scale"), vTf.property("ADBE Opacity"), duration * 0.5, delay + duration * 0.5);
            }
        }
    }

    function drawGroupedBarChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        var categoryW = chartW / n, totalBarW = categoryW * 0.7, barW = totalBarW / sCount;
        var duration = config.animation.duration, stagger = config.animation.stagger, bs = config.barStyle;
        if (bs.showBackground) for (var bgi = 0; bgi < n; bgi++) addBarBackground(comp, leftX + categoryW * (bgi + 0.5), baseY, totalBarW, chartH, bs.borderRadius, bs, "柱背景_" + bgi);
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            for (var i = 0; i < n; i++) {
                var value = data[i] || 0;
                var h = Math.max((value / axisMax) * chartH, bs.minHeight);
                var cx = leftX + categoryW * (i + 0.5) - totalBarW / 2 + barW * (s + 0.5);
                var delay = 0.25 + i * stagger + s * 0.04;
                var bl = addShapeLayer(comp, "柱_" + s + "_" + i); setLayerOrigin(bl);
                var root = bl.property("ADBE Root Vectors Group");
                var g = root.addProperty("ADBE Vector Group");
                var v = g.property("ADBE Vectors Group");
                var r = v.addProperty("ADBE Vector Shape - Rect");
                r.property("ADBE Vector Rect Size").setValue([barW, h]);
                r.property("ADBE Vector Rect Position").setValue([0, -h / 2]);
                r.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, barW / 2, h / 2));
                var f = v.addProperty("ADBE Vector Graphic - Fill");
                f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
                var tf = g.property("ADBE Vector Transform Group");
                tf.property("ADBE Vector Anchor").setValue([0, 0]);
                tf.property("ADBE Vector Position").setValue([cx, baseY]);
                applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
                if (config.label.show) {
                    var lY = computeBarLabelY(config.label.position, baseY, baseY - h, h, config.label.fontSize, false);
                    var vL = addTextLayer(comp, fmtValue(value, config.label, config._total), "值_" + s + "_" + i);
                    setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                    placeText(vL, cx, lY, 'center');
                    var vTf = vL.property("ADBE Transform Group");
                    applyLabelPop(vTf.property("ADBE Scale"), vTf.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.45);
                }
            }
        }
    }

    function drawStackedBarChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        var categoryW = chartW / n;
        var barW = Math.min(categoryW * 0.6, config.barStyle.maxWidth || 999);
        var duration = config.animation.duration, stagger = config.animation.stagger, bs = config.barStyle;
        if (bs.showBackground) for (var bgi = 0; bgi < n; bgi++) addBarBackground(comp, leftX + categoryW * (bgi + 0.5), baseY, barW, chartH, bs.borderRadius, bs, "柱背景_" + bgi);
        var cumulative = []; for (var ci = 0; ci < n; ci++) cumulative.push(0);
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            for (var i2 = 0; i2 < n; i2++) {
                var value = data[i2] || 0;
                var h = Math.max((value / axisMax) * chartH, 1);
                var cx = leftX + categoryW * (i2 + 0.5);
                var yPos = baseY - (cumulative[i2] / axisMax) * chartH;
                var bl = addShapeLayer(comp, "堆叠柱_" + s + "_" + i2); setLayerOrigin(bl);
                var root = bl.property("ADBE Root Vectors Group");
                var g = root.addProperty("ADBE Vector Group");
                var v = g.property("ADBE Vectors Group");
                var r = v.addProperty("ADBE Vector Shape - Rect");
                r.property("ADBE Vector Rect Size").setValue([barW, h]);
                r.property("ADBE Vector Rect Position").setValue([0, -h / 2]);
                var rr = 0; if (s === sCount - 1) rr = Math.min(bs.borderRadius, barW / 2, h / 2);
                r.property("ADBE Vector Rect Roundness").setValue(rr);
                var f = v.addProperty("ADBE Vector Graphic - Fill");
                f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
                var tf = g.property("ADBE Vector Transform Group");
                tf.property("ADBE Vector Anchor").setValue([0, 0]);
                tf.property("ADBE Vector Position").setValue([cx, yPos]);
                var delay = 0.25 + i2 * stagger + s * 0.06;
                applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
                if (config.label.show) {
                    var lY;
                    if (config.label.position === 'top') lY = yPos - h - config.label.fontSize * 0.7;
                    else if (config.label.position === 'bottom') lY = yPos + config.label.fontSize * 0.7;
                    else lY = (h >= config.label.fontSize * 1.3) ? yPos - h / 2 : yPos - h - config.label.fontSize * 0.7;
                    var vL = addTextLayer(comp, fmtValue(value, config.label, config._total), "值_" + s + "_" + i2);
                    setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                    placeText(vL, cx, lY, 'center');
                    var vTf = vL.property("ADBE Transform Group");
                    applyLabelPop(vTf.property("ADBE Scale"), vTf.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.4);
                }
                cumulative[i2] += value;
            }
        }
    }

    function drawHorizontalChart(comp, config, leftX, baseY, chartW, chartH, axisMax, data, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = data.length; if (n === 0) return;
        var categoryH = chartH / n, barH = Math.min(categoryH * 0.6, 100);
        var duration = config.animation.duration, bs = config.barStyle, suffix = config.yAxis.suffix || "";
        var yl = addShapeLayer(comp, "Y轴"); setLayerOrigin(yl);
        var yP = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
        var yS = new Shape(); yS.vertices = [[leftX, baseY], [leftX, baseY - chartH]]; yS.closed = false;
        yP.property("ADBE Vector Shape").setValue(yS);
        var yStk = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        yStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.yAxis.axisLineColor));
        yStk.property("ADBE Vector Stroke Width").setValue(config.yAxis.axisLineWidth);
        var yT = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        applyEaseOutTrim(yT.property("ADBE Vector Trim End"), duration * 0.6, 0.05);
        var xl = addShapeLayer(comp, "X轴"); setLayerOrigin(xl);
        var xP = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
        var xS = new Shape(); xS.vertices = [[leftX, baseY], [leftX + chartW, baseY]]; xS.closed = false;
        xP.property("ADBE Vector Shape").setValue(xS);
        var xStk = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        xStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.xAxis.axisLineColor));
        xStk.property("ADBE Vector Stroke Width").setValue(config.xAxis.axisLineWidth);
        var xT = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
        applyEaseOutTrim(xT.property("ADBE Vector Trim End"), duration * 0.6, 0.15);
        var axis = calculateTicks(axisMax, config.yAxis.tickCount);
        var ticks = axis.ticks;
        for (var t = 0; t < ticks.length; t++) {
            var val = ticks[t], x = leftX + (val / axis.max) * chartW;
            var tk = addShapeLayer(comp, "X刻度_" + val); setLayerOrigin(tk);
            var tP = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var tS = new Shape(); tS.vertices = [[x, baseY], [x, baseY + 6]]; tS.closed = false;
            tP.property("ADBE Vector Shape").setValue(tS);
            var tStk = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            tStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.xAxis.axisLineColor));
            tStk.property("ADBE Vector Stroke Width").setValue(config.xAxis.axisLineWidth);
            var nL = addTextLayer(comp, String(val) + suffix, "X标签_" + val);
            setTextDoc(nL, config.xAxis.labelFontSize, config.xAxis.labelColor, ParagraphJustification.CENTER_JUSTIFY);
            placeText(nL, x, baseY + config.xAxis.labelFontSize * 0.5 + 22, 'center');
            applyTextEnter(nL, duration * 0.45, 0.25 + t * 0.04, 0, 25);
            if (config.yAxis.splitLine.show && val > 0.0001) {
                var sl = addShapeLayer(comp, "X分割线_" + val); setLayerOrigin(sl);
                var slP = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var slS = new Shape(); slS.vertices = [[x, baseY], [x, baseY - chartH]]; slS.closed = false;
                slP.property("ADBE Vector Shape").setValue(slS);
                var slStk = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                slStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.yAxis.splitLine.color));
                slStk.property("ADBE Vector Stroke Width").setValue(2);
            }
        }
        if (bs.showBackground) {
            for (var bgi = 0; bgi < n; bgi++) {
                var bgCy = baseY - categoryH * (bgi + 0.5);
                var bg = addShapeLayer(comp, "柱背景_" + bgi); setLayerOrigin(bg);
                var bgR = bg.property("ADBE Root Vectors Group");
                var bgG = bgR.addProperty("ADBE Vector Group");
                var bgV = bgG.property("ADBE Vectors Group");
                var bgRect = bgV.addProperty("ADBE Vector Shape - Rect");
                bgRect.property("ADBE Vector Rect Size").setValue([chartW, barH]);
                bgRect.property("ADBE Vector Rect Position").setValue([chartW/2, 0]);
                bgRect.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, chartW/2, barH/2));
                var bgF = bgV.addProperty("ADBE Vector Graphic - Fill");
                bgF.property("ADBE Vector Fill Color").setValue(hexToRgb(bs.backgroundColor));
                var bgT = bgG.property("ADBE Vector Transform Group");
                bgT.property("ADBE Vector Anchor").setValue([0, 0]);
                bgT.property("ADBE Vector Position").setValue([leftX, bgCy]);
                bg.property("ADBE Transform Group").property("ADBE Opacity").setValue(bs.backgroundOpacity);
            }
        }
        for (var i = 0; i < n; i++) {
            var value = data[i];
            var w = Math.max((value / axis.max) * chartW, 2);
            var cy = baseY - categoryH * (i + 0.5);
            var colorHex = getColorByData(colors, i);
            var delay = 0.25 + i * config.animation.stagger;
            var cat = addTextLayer(comp, labels[i] || i, "类目标签_" + i);
            setTextDoc(cat, config.yAxis.labelFontSize, config.yAxis.labelColor, ParagraphJustification.RIGHT_JUSTIFY);
            placeText(cat, leftX - 20, cy, 'right');
            applyTextEnter(cat, duration * 0.45, 0.25 + i * 0.04, -25, 0);
            var bl = addShapeLayer(comp, "水平柱_" + i); setLayerOrigin(bl);
            var root = bl.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            var v = g.property("ADBE Vectors Group");
            var r = v.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue([w, barH]);
            r.property("ADBE Vector Rect Position").setValue([w/2, 0]);
            r.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, w/2, barH/2));
            var f = v.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            var tf = g.property("ADBE Vector Transform Group");
            tf.property("ADBE Vector Anchor").setValue([0, 0]);
            tf.property("ADBE Vector Position").setValue([leftX, cy]);
            applyElasticX(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
            if (config.label.show) {
                var vL = addTextLayer(comp, fmtValue(value, config.label, config._total), "值_" + i);
                setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.LEFT_JUSTIFY);
                placeText(vL, leftX + w + config.label.fontSize * 0.5, cy, 'left');
                var vTf = vL.property("ADBE Transform Group");
                applyLabelPop(vTf.property("ADBE Scale"), vTf.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.45);
            }
        }
    }

    function drawLineChart(comp, config, leftX, baseY, chartW, chartH, axisMax, values, labels, opts) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var lineColor = colors[0];
        var n = values.length; if (n < 2) return;
        var ls = config.lineStyle, duration = config.animation.duration, label = config.label;
        var mode = opts.mode || 'basic';
        var verts = [];
        for (var i = 0; i < n; i++) verts.push([leftX + (chartW / (n - 1)) * i, baseY - (values[i] / axisMax) * chartH]);
        var pathVerts = [], pathIn = [], pathOut = [];
        if (mode === 'step') {
            for (var s = 0; s < n - 1; s++) {
                pathVerts.push([verts[s][0], verts[s][1]]); pathIn.push([0,0]); pathOut.push([0,0]);
                pathVerts.push([verts[s+1][0], verts[s][1]]); pathIn.push([0,0]); pathOut.push([0,0]);
            }
            pathVerts.push([verts[n-1][0], verts[n-1][1]]); pathIn.push([0,0]); pathOut.push([0,0]);
        } else if ((mode === 'smooth' || ls.smooth) && n >= 3) {
            var sp = computeSmoothPath(verts); pathVerts = sp.vertices; pathIn = sp.inTangents; pathOut = sp.outTangents;
        } else {
            pathVerts = verts.slice();
            for (var k = 0; k < n; k++) { pathIn.push([0,0]); pathOut.push([0,0]); }
        }
        var showArea = ls.area || mode === 'area' || ls.gradient || mode === 'gradientArea';
        if (showArea) {
            var aV = pathVerts.slice(), aI = pathIn.slice(), aO = pathOut.slice();
            if (aI.length > 0) aI[0] = [0, 0];
            if (aO.length > 0) aO[aO.length - 1] = [0, 0];
            aV.push([pathVerts[pathVerts.length-1][0], baseY]); aV.push([pathVerts[0][0], baseY]);
            aI.push([0,0]); aO.push([0,0]); aI.push([0,0]); aO.push([0,0]);
            var aL = addShapeLayer(comp, "面积填充"); setLayerOrigin(aL);
            var aR = aL.property("ADBE Root Vectors Group");
            var aG = aR.addProperty("ADBE Vector Group");
            var aVt = aG.property("ADBE Vectors Group");
            var aP = aVt.addProperty("ADBE Vector Shape - Group");
            var aS = new Shape(); aS.vertices = aV; aS.inTangents = aI; aS.outTangents = aO; aS.closed = true;
            aP.property("ADBE Vector Shape").setValue(aS);
            var aF = aVt.addProperty("ADBE Vector Graphic - Fill");
            var useGrad = (mode === 'gradientArea') || ls.gradient;
            if (useGrad) {
                // 渐变面积：用线性渐变填充（顶部色 -> 底部色），对应 ECharts LinearGradient
                try {
                    var grad = aF.property("ADBE Vector Fill Color").addProperty("ADBE Vector Fill Gradient");
                    // AE 渐变默认黑白，逐 stop 覆写颜色与位置（顶=顶部色，底=底部色）
                    var stops = [[0, ls.gradTop || '#5B8FF9'], [1, ls.gradBottom || '#1B2A4A']];
                    for (var gi = 0; gi < stops.length; gi++) {
                        try {
                            var stOp = grad.addProperty("ADBE Vector Fill Gradient Color " + (gi + 1));
                            stOp.setValue(hexToRgb(stops[gi][1]));
                        } catch (e2) {}
                    }
                } catch (e3) {
                    // 宿主不支持渐变属性时退回纯色填充
                    aF.property("ADBE Vector Fill Color").setValue(hexToRgb(ls.gradTop || ls.areaColor));
                }
                aL.property("ADBE Transform Group").property("ADBE Opacity").setValue(ls.gradOpacity === undefined ? 70 : ls.gradOpacity);
            } else {
                aF.property("ADBE Vector Fill Color").setValue(hexToRgb(ls.areaColor));
                aL.property("ADBE Transform Group").property("ADBE Opacity").setValue(ls.areaOpacity);
            }
        }
        var lL = addShapeLayer(comp, "折线"); setLayerOrigin(lL);
        var lR = lL.property("ADBE Root Vectors Group");
        var lG = lR.addProperty("ADBE Vector Group");
        var lV = lG.property("ADBE Vectors Group");
        var lP = lV.addProperty("ADBE Vector Shape - Group");
        var lS = new Shape();
        lS.vertices = pathVerts; lS.inTangents = pathIn; lS.outTangents = pathOut; lS.closed = false;
        lP.property("ADBE Vector Shape").setValue(lS);
        var stk = lV.addProperty("ADBE Vector Graphic - Stroke");
        stk.property("ADBE Vector Stroke Color").setValue(hexToRgb(lineColor));
        stk.property("ADBE Vector Stroke Width").setValue(ls.width);
        try { stk.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
        try { stk.property("ADBE Vector Stroke Line Join").setValue(2); } catch (e) {}
        if (ls.type === 'dashed' || ls.type === 'dotted') {
            try {
                var d = stk.property("ADBE Vector Stroke Dashes");
                var d1 = d.addProperty("ADBE Vector Stroke Dash 1");
                var g1 = d.addProperty("ADBE Vector Stroke Gap 1");
                if (ls.type === 'dashed') { d1.setValue(14); g1.setValue(10); } else { d1.setValue(2); g1.setValue(8); }
            } catch (e) {}
        }
        var tr = lR.addProperty("ADBE Vector Filter - Trim");
        applyEaseOutTrim(tr.property("ADBE Vector Trim End"), duration * 0.85, 0.2);
        if (ls.showSymbol) {
            for (var j = 0; j < n; j++) {
                var dL = addShapeLayer(comp, "点_" + j); setLayerOrigin(dL);
                var dR = dL.property("ADBE Root Vectors Group");
                var dG = dR.addProperty("ADBE Vector Group");
                var dV = dG.property("ADBE Vectors Group");
                addSymbolShape(dV, ls, ls.symbolSize);
                var dotC = ls.symbolCycle ? getColorByData(colors, j) : lineColor;
                var dF = dV.addProperty("ADBE Vector Graphic - Fill");
                dF.property("ADBE Vector Fill Color").setValue(hexToRgb(dotC));
                if (ls.symbolBorderWidth > 0) {
                    var dStk = dV.addProperty("ADBE Vector Graphic - Stroke");
                    dStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(ls.symbolBorderColor));
                    dStk.property("ADBE Vector Stroke Width").setValue(ls.symbolBorderWidth);
                }
                var dT = dG.property("ADBE Vector Transform Group");
                dT.property("ADBE Vector Position").setValue(verts[j]);
                applyElasticScale(dT.property("ADBE Vector Scale"), duration * 0.4, 0.2 + (j / (n - 1)) * duration * 0.75);
            }
        }
        if (label.show) {
            for (var m = 0; m < n; m++) {
                var lY;
                if (label.position === 'bottom') lY = verts[m][1] + label.fontSize * 0.75;
                else if (label.position === 'inside') lY = verts[m][1] + label.fontSize * 0.55;
                else lY = verts[m][1] - label.fontSize * 0.75;
                var vL = addTextLayer(comp, fmtValue(values[m], label, config._total), "值_" + m);
                setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL, verts[m][0], lY, 'center');
                var vT = vL.property("ADBE Transform Group");
                applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.5, 0.2 + (m / (n-1)) * duration * 0.75 + duration * 0.15);
            }
        }
    }

    function drawStackedAreaChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        var duration = config.animation.duration, label = config.label;
        var cumulative = []; for (var i = 0; i < n; i++) cumulative.push(0);
        var layerBounds = [];
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            var topVerts = [], bottomVerts = [], prevCum = [];
            for (var i2 = 0; i2 < n; i2++) prevCum.push(cumulative[i2]);
            for (var i3 = 0; i3 < n; i3++) {
                cumulative[i3] += data[i3] || 0;
                topVerts.push([leftX + (chartW / (n - 1)) * i3, baseY - (cumulative[i3] / axisMax) * chartH]);
            }
            for (var i4 = n - 1; i4 >= 0; i4--) bottomVerts.push([leftX + (chartW / (n - 1)) * i4, baseY - (prevCum[i4] / axisMax) * chartH]);
            var areaVerts = topVerts.concat(bottomVerts);
            var aL = addShapeLayer(comp, "堆叠面积_" + s); setLayerOrigin(aL);
            var aR = aL.property("ADBE Root Vectors Group");
            var aG = aR.addProperty("ADBE Vector Group");
            var aV = aG.property("ADBE Vectors Group");
            var aP = aV.addProperty("ADBE Vector Shape - Group");
            var aS = new Shape(); aS.vertices = areaVerts; aS.closed = true;
            aP.property("ADBE Vector Shape").setValue(aS);
            var aF = aV.addProperty("ADBE Vector Graphic - Fill");
            aF.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            var op = aL.property("ADBE Transform Group").property("ADBE Opacity");
            op.setValueAtTime(0, 0);
            var tOp = 80 - s * 10; if (tOp < 50) tOp = 50;
            op.setValueAtTime(0.25 + duration * (s + 1) / sCount * 0.65, tOp);
            layerBounds.push({ series: s, data: data, topVerts: topVerts });
        }
        if (label.show) {
            for (var lb = 0; lb < layerBounds.length; lb++) {
                var info = layerBounds[lb];
                var sIdx = info.series, dData = info.data, tops = info.topVerts;
                for (var k = 0; k < n; k++) {
                    var value = dData[k] || 0, topY = tops[k][1], cx = tops[k][0];
                    var prevSum = 0;
                    for (var ps = 0; ps < sIdx; ps++) prevSum += seriesList[ps].data[k] || 0;
                    var bY = baseY - (prevSum / axisMax) * chartH;
                    var layerH = bY - topY;
                    var lY;
                    if (label.position === 'top') lY = topY - label.fontSize * 0.7;
                    else if (label.position === 'bottom') lY = bY + label.fontSize * 0.7;
                    else lY = (layerH >= label.fontSize * 1.3) ? (topY + bY) / 2 : topY - label.fontSize * 0.7;
                    var vL = addTextLayer(comp, fmtValue(value, label, config._total), "值_" + sIdx + "_" + k);
                    setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                    placeText(vL, cx, lY, 'center');
                    var vT = vL.property("ADBE Transform Group");
                    applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.5, 0.25 + (k / Math.max(n-1,1)) * duration * 0.6 + sIdx * 0.08);
                }
            }
        }
    }

    function drawComboChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels, dualAxis) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length;
        var duration = config.animation.duration, stagger = config.animation.stagger;
        var bs = config.barStyle, ls = config.lineStyle, yc = config.yAxis;
        var rightSuffix = yc.rightSuffix || "";
        var barColor = colors[0], lineColor = (colors.length > 1) ? colors[1] : colors[0];
        var barData = seriesList[0].data, lineData = seriesList[1].data;
        var slotW = chartW / n;
        var barW = parseSize(bs.width, slotW);
        if (bs.maxWidth > 0) barW = Math.min(barW, bs.maxWidth);
        barW = Math.min(barW, slotW * 0.7);
        var lineAxisMax = axisMax, axisRight = null;
        if (dualAxis) {
            var lineMax = Math.max.apply(null, lineData);
            axisRight = calculateTicks(lineMax, yc.tickCount);
            lineAxisMax = axisRight.max;
        }
        if (bs.showBackground) for (var bgi = 0; bgi < n; bgi++) addBarBackground(comp, leftX + slotW * (bgi + 0.5), baseY, barW, chartH, bs.borderRadius, bs, "柱背景_" + bgi);
        for (var i = 0; i < n; i++) {
            var value = barData[i];
            var h = Math.max((value / axisMax) * chartH, bs.minHeight);
            var cx = leftX + slotW * (i + 0.5);
            var delay = 0.25 + i * stagger;
            var bl = addShapeLayer(comp, "柱_" + i); setLayerOrigin(bl);
            var root = bl.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            var v = g.property("ADBE Vectors Group");
            var r = v.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue([barW, h]);
            r.property("ADBE Vector Rect Position").setValue([0, -h / 2]);
            r.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, barW / 2, h / 2));
            var f = v.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(hexToRgb(barColor));
            var tf = g.property("ADBE Vector Transform Group");
            tf.property("ADBE Vector Anchor").setValue([0, 0]);
            tf.property("ADBE Vector Position").setValue([cx, baseY]);
            applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
            if (config.label.show) {
                var lY = computeBarLabelY(config.label.position, baseY, baseY - h, h, config.label.fontSize, false);
                var vL = addTextLayer(comp, fmtValue(value, config.label, config._total), "柱值_" + i);
                setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL, cx, lY, 'center');
                var vT = vL.property("ADBE Transform Group");
                applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.45);
            }
        }
        var lineVerts = [];
        for (var j = 0; j < n; j++) lineVerts.push([leftX + slotW * (j + 0.5), baseY - (lineData[j] / lineAxisMax) * chartH]);
        var pathVerts = lineVerts, pathIn = [], pathOut = [];
        if (ls.smooth && n >= 3) {
            var sp = computeSmoothPath(lineVerts); pathVerts = sp.vertices; pathIn = sp.inTangents; pathOut = sp.outTangents;
        } else { for (var k = 0; k < n; k++) { pathIn.push([0,0]); pathOut.push([0,0]); } }
        var lL = addShapeLayer(comp, "折线_" + (seriesList[1] ? seriesList[1].name : "")); setLayerOrigin(lL);
        var lR = lL.property("ADBE Root Vectors Group");
        var lG = lR.addProperty("ADBE Vector Group");
        var lV = lG.property("ADBE Vectors Group");
        var lP = lV.addProperty("ADBE Vector Shape - Group");
        var lS = new Shape();
        lS.vertices = pathVerts; lS.inTangents = pathIn; lS.outTangents = pathOut; lS.closed = false;
        lP.property("ADBE Vector Shape").setValue(lS);
        var stk = lV.addProperty("ADBE Vector Graphic - Stroke");
        stk.property("ADBE Vector Stroke Color").setValue(hexToRgb(lineColor));
        stk.property("ADBE Vector Stroke Width").setValue(ls.width);
        try { stk.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
        var tr = lR.addProperty("ADBE Vector Filter - Trim");
        applyEaseOutTrim(tr.property("ADBE Vector Trim End"), duration * 0.85, 0.35);
        if (ls.showSymbol) {
            for (var m = 0; m < n; m++) {
                var dL = addShapeLayer(comp, "折线点_" + m); setLayerOrigin(dL);
                var dR = dL.property("ADBE Root Vectors Group");
                var dG = dR.addProperty("ADBE Vector Group");
                var dV = dG.property("ADBE Vectors Group");
                var el = dV.addProperty("ADBE Vector Shape - Ellipse");
                el.property("ADBE Vector Ellipse Size").setValue([ls.symbolSize, ls.symbolSize]);
                var dF = dV.addProperty("ADBE Vector Graphic - Fill");
                dF.property("ADBE Vector Fill Color").setValue(hexToRgb(lineColor));
                if (ls.symbolBorderWidth > 0) {
                    var dStk = dV.addProperty("ADBE Vector Graphic - Stroke");
                    dStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(ls.symbolBorderColor));
                    dStk.property("ADBE Vector Stroke Width").setValue(ls.symbolBorderWidth);
                }
                var dT = dG.property("ADBE Vector Transform Group");
                dT.property("ADBE Vector Position").setValue(lineVerts[m]);
                applyElasticScale(dT.property("ADBE Vector Scale"), duration * 0.4, 0.35 + (m / Math.max(n-1,1)) * duration * 0.75);
            }
        }
        if (config.label.show) {
            for (var mm = 0; mm < n; mm++) {
                var lY2;
                if (config.label.position === 'bottom') lY2 = lineVerts[mm][1] + config.label.fontSize * 0.75;
                else if (config.label.position === 'inside') lY2 = lineVerts[mm][1] + config.label.fontSize * 0.55;
                else lY2 = lineVerts[mm][1] - config.label.fontSize * 0.75;
                var vL2 = addTextLayer(comp, fmtValue(lineData[mm], config.label, config._total), "折线值_" + mm);
                setTextDoc(vL2, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL2, lineVerts[mm][0], lY2, 'center');
                var vT2 = vL2.property("ADBE Transform Group");
                applyLabelPop(vT2.property("ADBE Scale"), vT2.property("ADBE Opacity"), duration * 0.5, 0.35 + (mm / Math.max(n-1,1)) * duration * 0.75);
            }
        }
        if (dualAxis && axisRight) {
            var rightX = leftX + chartW;
            var ra = addShapeLayer(comp, "Y轴_右侧"); setLayerOrigin(ra);
            var raP = ra.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var raS = new Shape(); raS.vertices = [[rightX, baseY], [rightX, baseY - chartH]]; raS.closed = false;
            raP.property("ADBE Vector Shape").setValue(raS);
            var raStk = ra.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            raStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(lineColor));
            raStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
            var raT = ra.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Trim");
            applyEaseOutTrim(raT.property("ADBE Vector Trim End"), duration * 0.6, 0.1);
            var rTicks = axisRight.ticks;
            for (var t = 0; t < rTicks.length; t++) {
                var rVal = rTicks[t], rY = baseY - (rVal / axisRight.max) * chartH;
                var rt = addShapeLayer(comp, "Y右刻度_" + rVal); setLayerOrigin(rt);
                var rtP = rt.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var rtS = new Shape(); rtS.vertices = [[rightX, rY], [rightX + 8, rY]]; rtS.closed = false;
                rtP.property("ADBE Vector Shape").setValue(rtS);
                var rtStk = rt.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                rtStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(lineColor));
                rtStk.property("ADBE Vector Stroke Width").setValue(yc.axisLineWidth);
                var rNL = addTextLayer(comp, String(rVal) + rightSuffix, "Y右标签_" + rVal);
                setTextDoc(rNL, yc.labelFontSize, lineColor, ParagraphJustification.LEFT_JUSTIFY);
                placeText(rNL, rightX + 20, rY, 'left');
                applyTextEnter(rNL, duration * 0.45, 0.3 + t * 0.04, 25, 0);
            }
            if (seriesList[1] && seriesList[1].name) {
                var rN = addTextLayer(comp, seriesList[1].name, "Y轴名称_右");
                var rNSize = Math.max(yc.labelFontSize - 4, 20);
                setTextDoc(rN, rNSize, lineColor, ParagraphJustification.CENTER_JUSTIFY);
                placeText(rN, rightX, baseY - chartH - yc.labelFontSize * 1.2, 'center');
                applyTextEnter(rN, duration * 0.6, 0.4, 0, -20);
            }
        }
    }

    // 正负值柱状图：以 0 轴为基准，正值向上、负值向下（对应 ECharts 含负值的柱状图）
    // 复用 drawBarChart 的矩形绘制方式，仅把基线改为 0 轴位置
    function drawNegativeBarChart(comp, config, leftX, baseY, chartW, chartH, axis, values, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = values.length; if (n === 0) return;
        var bs = config.barStyle, label = config.label;
        var duration = config.animation.duration, stagger = config.animation.stagger;
        var axisMin = axis.min, axisMax = axis.max, span = axisMax - axisMin;
        if (span <= 0) span = 1;
        var zeroY = baseY - (0 - axisMin) / span * chartH;
        var slotW = chartW / n;
        var barW = parseSize(bs.width, slotW);
        if (bs.maxWidth > 0) barW = Math.min(barW, bs.maxWidth);
        barW = Math.min(barW, slotW * 0.95); if (barW < 2) barW = 2;

        for (var i = 0; i < n; i++) {
            var value = values[i];
            // 矩形内部固定用 Rect Position = [0, -h/2]，含义是「矩形从图层锚点处向上铺满 h」，
            // 即实际占用区间恒为 [anchor - h, anchor]。据此反推锚点：
            //   正值：区间应为 [zeroY - h, zeroY] -> anchor = zeroY
            //   负值：区间应为 [zeroY, zeroY + h]  -> anchor = zeroY + h
            // 若负值也写 anchor = zeroY，矩形会从 0 轴向上长（与正值同向），既画反又冲出绘图区顶。
            var rawH = Math.abs(value) / span * chartH;
            var barH = Math.max(rawH, bs.minHeight);
            var barAnchor = value >= 0 ? zeroY : (zeroY + barH);
            var cx = leftX + slotW * (i + 0.5);
            var colorHex = getColorByData(colors, i);
            var delay = 0.25 + i * stagger;
            var bl = addShapeLayer(comp, "柱_" + i); setLayerOrigin(bl);
            var root = bl.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            var v = g.property("ADBE Vectors Group");
            var rr2 = v.addProperty("ADBE Vector Shape - Rect");
            rr2.property("ADBE Vector Rect Size").setValue([barW, barH]);
            rr2.property("ADBE Vector Rect Position").setValue([0, -barH / 2]);
            rr2.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, barW / 2, barH / 2));
            var f2 = v.addProperty("ADBE Vector Graphic - Fill");
            f2.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            if (bs.borderWidth > 0) {
                var sk2 = v.addProperty("ADBE Vector Graphic - Stroke");
                sk2.property("ADBE Vector Stroke Color").setValue(hexToRgb(bs.borderColor));
                sk2.property("ADBE Vector Stroke Width").setValue(bs.borderWidth);
            }
            var tf2 = g.property("ADBE Vector Transform Group");
            tf2.property("ADBE Vector Anchor").setValue([0, 0]);
            tf2.property("ADBE Vector Position").setValue([cx, barAnchor]);
            applyElasticY(tf2.property("ADBE Vector Scale"), duration * 0.7, delay);
            if (bs.opacity < 100) bl.property("ADBE Transform Group").property("ADBE Opacity").setValue(bs.opacity);
            if (label.show) {
                // 正值标在柱顶（0 轴上方 barH 处）之上；负值标在柱底（0 轴下方 barH 处）之下
                var lY = value >= 0 ? (zeroY - barH - label.fontSize * 0.7) : (zeroY + barH + label.fontSize * 0.7);
                var vL = addTextLayer(comp, fmtValue(value, label, config._total), "值_" + i);
                setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL, cx, lY, 'center');
                var vTf = vL.property("ADBE Transform Group");
                applyLabelPop(vTf.property("ADBE Scale"), vTf.property("ADBE Opacity"), duration * 0.5, delay + duration * 0.5);
            }
        }
    }

    // 瀑布图：数据为增量（可正可负），逐段累加形成悬浮柱（对齐 ECharts 官网：无合计柱）
    // 对应 ECharts 用堆叠 + 透明占位柱模拟的瀑布图
    function drawWaterfallChart(comp, config, leftX, baseY, chartW, chartH, axis, values, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var bs = config.barStyle, label = config.label;
        var duration = config.animation.duration, stagger = config.animation.stagger;
        var axisMin = axis.min, axisMax = axis.max, span = axisMax - axisMin;
        if (span <= 0) span = 1;
        var zeroY = baseY - (0 - axisMin) / span * chartH;
        var v2y = function (val) { return baseY - (val - axisMin) / span * chartH; };

        var inc = values.slice();           // 增量序列
        var n = inc.length;
        if (n === 0) return;

        var slotW = chartW / n;
        var barW = parseSize(bs.width, slotW);
        if (bs.maxWidth > 0) barW = Math.min(barW, bs.maxWidth);
        barW = Math.min(barW, slotW * 0.8); if (barW < 2) barW = 2;

        // 逐步累加，得到每段的起止高度（对齐 ECharts 官网瀑布图：只画增量段，不追加合计柱）
        var running = 0, tops = [], bots = [], cumAfter = [];
        for (var i = 0; i < n; i++) {
            var from = running, to = running + inc[i];
            tops.push(Math.max(from, to)); bots.push(Math.min(from, to));
            running = to; cumAfter.push(running);
        }

        for (var j = 0; j < n; j++) {
            var topVal = tops[j], botVal = bots[j];
            var yTop = v2y(topVal), yBot = v2y(botVal);
            // 矩形内部固定用 Rect Position=[0,-h/2]，实际占用恒为 [anchor-h, anchor]。
            // 要让矩形正好覆盖 [yTop, yBot]（yTop ≤ yBot），锚点必须取底边 yBot。
            // 注意不能用 max(yTop, yBot-h)：h 本身由 (yBot-yTop) 导出时会退化成 yTop，
            // 于是矩形从 yTop 再向上长一整个 h，段就会冲出绘图区顶。
            // minHeight 触发的补高只允许向下溢出，故锚点取 yBot，高度取 max(yBot-yTop, minHeight)。
            var barH = Math.max(yBot - yTop, bs.minHeight);
            var barAnchor = yBot;
            var cx = leftX + slotW * (j + 0.5);
            // 颜色按增量正负区分（增/减两种语义色），与官网一致
            var colorHex = inc[j] >= 0 ? colors[0] : colors[(colors.length > 3 ? 3 : 1) % colors.length];

            var delay = 0.25 + j * stagger;
            var bl = addShapeLayer(comp, "瀑布_" + j); setLayerOrigin(bl);
            var root = bl.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            var v = g.property("ADBE Vectors Group");
            var r = v.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue([barW, barH]);
            r.property("ADBE Vector Rect Position").setValue([0, -barH / 2]);
            r.property("ADBE Vector Rect Roundness").setValue(Math.min(bs.borderRadius, barW / 2, barH / 2));
            var f = v.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
            if (bs.borderWidth > 0) {
                var sk = v.addProperty("ADBE Vector Graphic - Stroke");
                sk.property("ADBE Vector Stroke Color").setValue(hexToRgb(bs.borderColor));
                sk.property("ADBE Vector Stroke Width").setValue(bs.borderWidth);
            }
            var tf = g.property("ADBE Vector Transform Group");
            tf.property("ADBE Vector Anchor").setValue([0, 0]);
            tf.property("ADBE Vector Position").setValue([cx, barAnchor]);
            applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.6, delay);
            if (bs.opacity < 100) bl.property("ADBE Transform Group").property("ADBE Opacity").setValue(bs.opacity);

            // 柱间连接线：从上一段的终点（cumAfter）水平连到本段的起点（cumAfter 的上一值）
            if (bs.waterfallConnector && j > 0) {
                var prevEndY = v2y(cumAfter[j - 1]);
                var conn = addShapeLayer(comp, "连接线_" + j); setLayerOrigin(conn);
                var cP = conn.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var cS = new Shape();
                cS.vertices = [[leftX + slotW * (j - 0.5), prevEndY], [leftX + slotW * (j + 0.5), prevEndY]];
                cS.closed = false;
                cP.property("ADBE Vector Shape").setValue(cS);
                var cStk = conn.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                cStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(bs.waterfallConnectorColor));
                cStk.property("ADBE Vector Stroke Width").setValue(2);
                try {
                    var cDas = cStk.property("ADBE Vector Stroke Dashes");
                    cDas.addProperty("ADBE Vector Stroke Dash 1").setValue(8);
                    cDas.addProperty("ADBE Vector Stroke Gap 1").setValue(6);
                } catch (e) {}
                conn.property("ADBE Transform Group").property("ADBE Opacity").setValueAtTime(0, 0);
                conn.property("ADBE Transform Group").property("ADBE Opacity").setValueAtTime(delay, 100);
            }

            if (label.show) {
                var val = inc[j];
                // 向上增长的段标在顶边上方；向下增长的段（负增量）标在底边下方
                var lY = (topVal >= botVal) ? (yTop - label.fontSize * 0.7) : (yBot + label.fontSize * 0.7);
                var vL = addTextLayer(comp, fmtValue(val, label, config._total), "值_" + j);
                setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                placeText(vL, cx, lY, 'center');
                var vT = vL.property("ADBE Transform Group");
                applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.5, delay + duration * 0.4);
            }
        }
    }

    // 堆叠百分比柱状图：各分类按总量归一化到 100%（对应 ECharts 堆叠归一化）
    function drawStackedNormChart(comp, config, leftX, baseY, chartW, chartH, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        if (n === 0 || sCount === 0) return;
        var categoryW = chartW / n;
        var barW = Math.min(categoryW * 0.6, config.barStyle.maxWidth || 999);
        var duration = config.animation.duration, stagger = config.animation.stagger, bs = config.barStyle;
        var usePercent = bs.stackLabelPercent !== false;

        var totals = [];
        for (var ti = 0; ti < n; ti++) {
            var sum = 0;
            for (var ts = 0; ts < sCount; ts++) sum += seriesList[ts].data[ti] || 0;
            totals.push(sum);
        }
        if (bs.showBackground) for (var bgi = 0; bgi < n; bgi++) addBarBackground(comp, leftX + categoryW * (bgi + 0.5), baseY, barW, chartH, bs.borderRadius, bs, "柱背景_" + bgi);

        var cumulative = []; for (var ci = 0; ci < n; ci++) cumulative.push(0);
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            for (var i = 0; i < n; i++) {
                var raw = data[i] || 0;
                var tot = totals[i];
                var frac = tot > 0 ? raw / tot : 0;
                if (frac <= 0) { continue; }
                var h = Math.max(frac * chartH, raw > 0 ? 1 : 0);
                var cx = leftX + categoryW * (i + 0.5);
                // 归一化坐标：累计占比 × 绘图区高（不可再除以原始总量，否则段位上移、整柱冲出顶部）
                var yPos = baseY - cumulative[i] * chartH;
                var bl = addShapeLayer(comp, "归一柱_" + s + "_" + i); setLayerOrigin(bl);
                var root = bl.property("ADBE Root Vectors Group");
                var g = root.addProperty("ADBE Vector Group");
                var v = g.property("ADBE Vectors Group");
                var r = v.addProperty("ADBE Vector Shape - Rect");
                r.property("ADBE Vector Rect Size").setValue([barW, h]);
                r.property("ADBE Vector Rect Position").setValue([0, -h / 2]);
                var rr = 0;
                if (bs.borderRadius > 0) {
                    if (s === sCount - 1) rr = Math.min(bs.borderRadius, barW / 2, h / 2);   // 仅顶段圆角
                    else if (s === 0) rr = Math.min(bs.borderRadius, barW / 2, h / 2);
                }
                r.property("ADBE Vector Rect Roundness").setValue(rr);
                var f = v.addProperty("ADBE Vector Graphic - Fill");
                f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
                var tf = g.property("ADBE Vector Transform Group");
                tf.property("ADBE Vector Anchor").setValue([0, 0]);
                tf.property("ADBE Vector Position").setValue([cx, yPos]);
                var delay = 0.25 + i * stagger + s * 0.06;
                applyElasticY(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
                if (config.label.show) {
                    var txt = usePercent ? (frac * 100).toFixed(1) + "%" : String(raw);
                    if (h >= config.label.fontSize * 1.3) {   // 太薄不标
                        var vL = addTextLayer(comp, txt, "值_" + s + "_" + i);
                        setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                        placeText(vL, cx, yPos - h / 2, 'center');
                        var vT = vL.property("ADBE Transform Group");
                        applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.4);
                    }
                }
                cumulative[i] += frac;
            }
        }
    }

    // 水平堆叠条形图：横向的堆叠柱（对应 ECharts 堆叠条形图）
    function drawHorizontalStackedChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        if (n === 0 || sCount === 0) return;
        var duration = config.animation.duration, stagger = config.animation.stagger, bs = config.barStyle;
        var categoryH = chartH / n;
        var barH = Math.min(categoryH * 0.6, 100);

        // Y 轴（类目）与 X 轴（数值）
        var yl = addShapeLayer(comp, "Y轴"); setLayerOrigin(yl);
        var yP = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
        var yS = new Shape(); yS.vertices = [[leftX, baseY], [leftX, baseY - chartH]]; yS.closed = false;
        yP.property("ADBE Vector Shape").setValue(yS);
        var yStk = yl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        yStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.yAxis.axisLineColor));
        yStk.property("ADBE Vector Stroke Width").setValue(config.yAxis.axisLineWidth);
        var xl = addShapeLayer(comp, "X轴"); setLayerOrigin(xl);
        var xP = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
        var xS = new Shape(); xS.vertices = [[leftX, baseY], [leftX + chartW, baseY]]; xS.closed = false;
        xP.property("ADBE Vector Shape").setValue(xS);
        var xStk = xl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        xStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.xAxis.axisLineColor));
        xStk.property("ADBE Vector Stroke Width").setValue(config.xAxis.axisLineWidth);

        var axis = calculateTicks(axisMax, config.yAxis.tickCount);
        var suffix = config.yAxis.suffix || "";
        for (var t = 0; t < axis.ticks.length; t++) {
            var val = axis.ticks[t], x = leftX + (val / axis.max) * chartW;
            var tk = addShapeLayer(comp, "X刻度_" + val); setLayerOrigin(tk);
            var tP = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
            var tS = new Shape(); tS.vertices = [[x, baseY], [x, baseY + 6]]; tS.closed = false;
            tP.property("ADBE Vector Shape").setValue(tS);
            var tStk = tk.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
            tStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.xAxis.axisLineColor));
            tStk.property("ADBE Vector Stroke Width").setValue(config.xAxis.axisLineWidth);
            var nL = addTextLayer(comp, String(val) + suffix, "X标签_" + val);
            setTextDoc(nL, config.xAxis.labelFontSize, config.xAxis.labelColor, ParagraphJustification.CENTER_JUSTIFY);
            placeText(nL, x, baseY + config.xAxis.labelFontSize * 0.5 + 22, 'center');
            if (config.yAxis.splitLine.show && val > 0.0001) {
                var sl = addShapeLayer(comp, "X分割线_" + val); setLayerOrigin(sl);
                var slP = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Shape - Group");
                var slS = new Shape(); slS.vertices = [[x, baseY], [x, baseY - chartH]]; slS.closed = false;
                slP.property("ADBE Vector Shape").setValue(slS);
                var slStk = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                slStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(config.yAxis.splitLine.color));
                slStk.property("ADBE Vector Stroke Width").setValue(2);
            }
        }

        var cum = []; for (var ci = 0; ci < n; ci++) cum.push(0);
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            for (var i = 0; i < n; i++) {
                var value = data[i] || 0;
                var w = (value / axis.max) * chartW;
                if (w <= 0) continue;
                var cy = baseY - categoryH * (i + 0.5);
                var xPos = leftX + (cum[i] / axis.max) * chartW;
                var bl = addShapeLayer(comp, "水平堆叠_" + s + "_" + i); setLayerOrigin(bl);
                var root = bl.property("ADBE Root Vectors Group");
                var g = root.addProperty("ADBE Vector Group");
                var v = g.property("ADBE Vectors Group");
                var r = v.addProperty("ADBE Vector Shape - Rect");
                r.property("ADBE Vector Rect Size").setValue([w, barH]);
                r.property("ADBE Vector Rect Position").setValue([w / 2, 0]);
                var rr = 0;
                if (bs.borderRadius > 0 && (s === sCount - 1 || s === 0)) rr = Math.min(bs.borderRadius, w / 2, barH / 2);
                r.property("ADBE Vector Rect Roundness").setValue(rr);
                var f = v.addProperty("ADBE Vector Graphic - Fill");
                f.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
                var tf = g.property("ADBE Vector Transform Group");
                tf.property("ADBE Vector Anchor").setValue([0, 0]);
                tf.property("ADBE Vector Position").setValue([xPos, cy]);
                var delay = 0.25 + i * stagger + s * 0.06;
                applyElasticX(tf.property("ADBE Vector Scale"), duration * 0.7, delay);
                if (config.label.show && value > 0) {
                    var vL = addTextLayer(comp, fmtValue(value, config.label, config._total), "值_" + s + "_" + i);
                    setTextDoc(vL, config.label.fontSize, config.label.color, ParagraphJustification.CENTER_JUSTIFY);
                    placeText(vL, xPos + w / 2, cy, 'center');
                    var vT = vL.property("ADBE Transform Group");
                    applyLabelPop(vT.property("ADBE Scale"), vT.property("ADBE Opacity"), duration * 0.45, delay + duration * 0.4);
                }
                cum[i] += value;
            }
        }
        // 类目标签
        for (var li = 0; li < n; li++) {
            var cat = addTextLayer(comp, labels[li] || li, "类目标签_" + li);
            setTextDoc(cat, config.yAxis.labelFontSize, config.yAxis.labelColor, ParagraphJustification.RIGHT_JUSTIFY);
            placeText(cat, leftX - 20, baseY - categoryH * (li + 0.5), 'right');
            applyTextEnter(cat, duration * 0.45, 0.25 + li * 0.04, -25, 0);
        }
    }

    // 堆叠折线图：多条折线按分类累加（对应 ECharts 堆叠折线图，无面积填充）
    function drawStackedLineChart(comp, config, leftX, baseY, chartW, chartH, axisMax, seriesList, labels) {
        var colors = (config.color && config.color.length) ? config.color : ['#5B8FF9'];
        var n = labels.length, sCount = seriesList.length;
        if (n < 2 || sCount === 0) return;
        var ls = config.lineStyle, duration = config.animation.duration, label = config.label;
        var cumulative = []; for (var ci = 0; ci < n; ci++) cumulative.push(0);
        for (var s = 0; s < sCount; s++) {
            var data = seriesList[s].data, colorHex = getColorBySeries(colors, s);
            var verts = [], pathVerts = [], pathIn = [], pathOut = [];
            for (var i = 0; i < n; i++) {
                cumulative[i] += data[i] || 0;
                verts.push([leftX + (chartW / (n - 1)) * i, baseY - (cumulative[i] / axisMax) * chartH]);
            }
            if (ls.smooth && n >= 3) {
                var sp = computeSmoothPath(verts); pathVerts = sp.vertices; pathIn = sp.inTangents; pathOut = sp.outTangents;
            } else { pathVerts = verts.slice(); for (var k = 0; k < n; k++) { pathIn.push([0,0]); pathOut.push([0,0]); } }
            var lL = addShapeLayer(comp, "堆叠折线_" + s); setLayerOrigin(lL);
            var lR = lL.property("ADBE Root Vectors Group");
            var lG = lR.addProperty("ADBE Vector Group");
            var lV = lG.property("ADBE Vectors Group");
            var lP = lV.addProperty("ADBE Vector Shape - Group");
            var lS = new Shape();
            lS.vertices = pathVerts; lS.inTangents = pathIn; lS.outTangents = pathOut; lS.closed = false;
            lP.property("ADBE Vector Shape").setValue(lS);
            var stk = lV.addProperty("ADBE Vector Graphic - Stroke");
            stk.property("ADBE Vector Stroke Color").setValue(hexToRgb(colorHex));
            stk.property("ADBE Vector Stroke Width").setValue(ls.width);
            try { stk.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
            var tr = lR.addProperty("ADBE Vector Filter - Trim");
            applyEaseOutTrim(tr.property("ADBE Vector Trim End"), duration * 0.7, 0.2 + s * 0.1);
            if (ls.showSymbol) {
                for (var j = 0; j < n; j++) {
                    var dL = addShapeLayer(comp, "点_" + s + "_" + j); setLayerOrigin(dL);
                    var dR = dL.property("ADBE Root Vectors Group");
                    var dG = dR.addProperty("ADBE Vector Group");
                    var dV = dG.property("ADBE Vectors Group");
                    addSymbolShape(dV, ls, ls.symbolSize);
                    var dF = dV.addProperty("ADBE Vector Graphic - Fill");
                    dF.property("ADBE Vector Fill Color").setValue(hexToRgb(colorHex));
                    if (ls.symbolBorderWidth > 0) {
                        var dStk = dV.addProperty("ADBE Vector Graphic - Stroke");
                        dStk.property("ADBE Vector Stroke Color").setValue(hexToRgb(ls.symbolBorderColor));
                        dStk.property("ADBE Vector Stroke Width").setValue(ls.symbolBorderWidth);
                    }
                    var dT = dG.property("ADBE Vector Transform Group");
                    dT.property("ADBE Vector Position").setValue(verts[j]);
                    applyElasticScale(dT.property("ADBE Vector Scale"), duration * 0.4, 0.2 + (j / (n - 1)) * duration * 0.6);
                }
            }
            if (label.show) {
                for (var m = 0; m < n; m++) {
                    var lY = verts[m][1] - label.fontSize * 0.75;
                    var vL = addTextLayer(comp, fmtValue(data[m] || 0, label, config._total), "值_" + s + "_" + m);
                    setTextDoc(vL, label.fontSize, label.color, ParagraphJustification.CENTER_JUSTIFY);
                    placeText(vL, verts[m][0], lY, 'center');
                }
            }
        }
    }

    // 按 symbolType 往矢量组里加对应形状（默认圆形）；尺寸统一按 symbolSize
    function addSymbolShape(vectorsGroup, ls, size) {
        var st = ls.symbolType || 'circle';
        var half = size / 2;
        if (st === 'rect') {
            var r = vectorsGroup.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue([size, size]);
            return;
        }
        if (st === 'roundRect') {
            var r2 = vectorsGroup.addProperty("ADBE Vector Shape - Rect");
            r2.property("ADBE Vector Rect Size").setValue([size, size]);
            r2.property("ADBE Vector Rect Roundness").setValue(Math.min(half * 0.6, 8));
            return;
        }
        if (st === 'triangle' || st === 'diamond') {
            var pg = vectorsGroup.addProperty("ADBE Vector Shape - Group");
            var sh = new Shape(), verts, inT = [], outT = [];
            if (st === 'triangle') {
                var h = size * 0.866;
                verts = [[0, -half], [h / 2, half * 0.5], [-h / 2, half * 0.5]];
            } else {
                verts = [[0, -half], [half, 0], [0, half], [-half, 0]];
            }
            for (var i = 0; i < verts.length; i++) { inT.push([0, 0]); outT.push([0, 0]); }
            sh.vertices = verts; sh.inTangents = inT; sh.outTangents = outT; sh.closed = true;
            pg.property("ADBE Vector Shape").setValue(sh);
            return;
        }
        var el = vectorsGroup.addProperty("ADBE Vector Shape - Ellipse");
        el.property("ADBE Vector Ellipse Size").setValue([size, size]);
        if (st === 'emptyCircle') {
            // 空心圆：填充留白由调用方处理，此处仅确保有描边可用
        }
    }

    // 平滑曲线路径（Catmull-Rom 近似）：返回顶点与进出切线
    function computeSmoothPath(points) {
        var n = points.length;
        var vertices = [], inT = [], outT = [];
        for (var i = 0; i < n; i++) {
            vertices.push(points[i]);
            var dx, dy;
            if (i === 0) { dx = (points[1][0] - points[0][0]) / 3; dy = (points[1][1] - points[0][1]) / 3; }
            else if (i === n - 1) { dx = (points[n-1][0] - points[n-2][0]) / 3; dy = (points[n-1][1] - points[n-2][1]) / 3; }
            else { dx = (points[i+1][0] - points[i-1][0]) / 6; dy = (points[i+1][1] - points[i-1][1]) / 6; }
            inT.push([-dx, -dy]); outT.push([dx, dy]);
        }
        return { vertices: vertices, inTangents: inT, outTangents: outT };
    }

    // ============ 主入口 ============
    var win = buildUI(thisObj);
    if (win instanceof Window) {
        $.global._aeChartWin = win;
        win.layout.layout(true);
        try { win.size = [600, 880]; } catch (e) {}
        win.center();
        win.show();
        try { win.layout.layout(true); } catch (e) {}
        try {
            (function findCV(c) {
                for (var i = 0; i < c.children.length; i++) {
                    var ch = c.children[i];
                    if (ch.type === "customview") { ch.notify("onDraw"); return; }
                    if (ch.children && ch.children.length) findCV(ch);
                }
            })(win);
        } catch (e) {}
    } else {
        win.layout.layout(true);
    }

})(this);