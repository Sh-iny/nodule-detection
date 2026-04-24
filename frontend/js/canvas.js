/**
 * Canvas 模块 - 图像绘制和标注
 */

// 画布和上下文
let imageCanvas, overlayCanvas;
let imageCtx, overlayCtx;
let originalImage = null;
let currentZoom = 1;

// 显示尺寸（全局变量）
let displayWidth = 0;
let displayHeight = 0;

// 拖动状态
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panOffsetX = 0;  // X方向偏移
let panOffsetY = 0;  // Y方向偏移

// 置信度颜色映射
function getConfidenceColor(confidence) {
    if (confidence >= 0.9) return '#22c55e';      // 绿色
    if (confidence >= 0.7) return '#f59e0b';      // 橙色
    return '#ef4444';                              // 红色
}

// 初始化画布
function initCanvas() {
    imageCanvas = document.getElementById('imageCanvas');
    overlayCanvas = document.getElementById('overlayCanvas');
    const container = document.getElementById('imageContainer');

    if (!imageCanvas || !overlayCanvas || !container) {
        console.error('Canvas elements not found');
        return;
    }

    imageCtx = imageCanvas.getContext('2d');
    overlayCtx = overlayCanvas.getContext('2d');

    // 鼠标拖动事件
    container.addEventListener('mousedown', (e) => {
        if (e.button === 0) { // 左键
            isDragging = true;
            dragStartX = e.clientX - panOffsetX;
            dragStartY = e.clientY - panOffsetY;
            container.style.cursor = 'grabbing';
        }
    });

    container.addEventListener('mousemove', (e) => {
        if (isDragging) {
            panOffsetX = e.clientX - dragStartX;
            panOffsetY = e.clientY - dragStartY;
            updateCanvasPosition();
        }
    });

    container.addEventListener('mouseup', () => {
        isDragging = false;
        container.style.cursor = 'grab';
    });

    container.addEventListener('mouseleave', () => {
        isDragging = false;
        container.style.cursor = 'default';
    });

    // 双击重置位置
    container.addEventListener('dblclick', () => {
        panOffsetX = 0;
        panOffsetY = 0;
        updateCanvasPosition();
    });
}

// 更新画布位置
function updateCanvasPosition() {
    const container = document.getElementById('imageContainer');
    if (!container) return;

    const transform = `translate(calc(-50% + ${panOffsetX}px), calc(-50% + ${panOffsetY}px))`;
    imageCanvas.style.transform = transform;
    overlayCanvas.style.transform = transform;
}

// 加载图像
function loadImage(file) {
    // 重置缩放和位置
    currentZoom = 1;
    panOffsetX = 0;
    panOffsetY = 0;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;
                resizeCanvas();
                document.getElementById('imagePlaceholder').classList.add('hidden');
                resolve(img);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    // 重置缩放和位置
    currentZoom = 1;
    panOffsetX = 0;
    panOffsetY = 0;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            resizeCanvas();
            document.getElementById('imagePlaceholder').classList.add('hidden');
            resolve(img);
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// 调整画布大小
function resizeCanvas() {
    if (!originalImage) return;

    const container = document.getElementById('imageContainer');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // 计算图像缩放比例（适应容器，不超出）
    const scaleX = containerWidth / originalImage.width;
    const scaleY = containerHeight / originalImage.height;
    const fitScale = Math.min(scaleX, scaleY, 1);

    // 计算显示尺寸
    displayWidth = originalImage.width * fitScale * currentZoom;
    displayHeight = originalImage.height * fitScale * currentZoom;

    // 设置画布尺寸
    imageCanvas.width = displayWidth;
    imageCanvas.height = displayHeight;
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;

    // 绘制图像
    imageCtx.drawImage(originalImage, 0, 0, displayWidth, displayHeight);

    // 更新缩放显示
    document.getElementById('zoomLevel').textContent = `${Math.round(currentZoom * 100)}%`;
}

// 绘制结节标记
// 绘制肺部轮廓
function drawLungContours() {
    const contours = window.currentLungContours;
    if (!contours || contours.length === 0 || !originalImage) return;

    const scaleX = displayWidth > 0 ? displayWidth / originalImage.width : 1;
    const scaleY = displayHeight > 0 ? displayHeight / originalImage.height : 1;

    overlayCtx.strokeStyle = '#22c55e';
    overlayCtx.lineWidth = 2;

    contours.forEach(contour => {
        if (contour.length < 3) return;

        overlayCtx.beginPath();
        overlayCtx.moveTo(contour[0][0] * scaleX, contour[0][1] * scaleY);

        for (let i = 1; i < contour.length; i++) {
            overlayCtx.lineTo(contour[i][0] * scaleX, contour[i][1] * scaleY);
        }

        overlayCtx.closePath();
        overlayCtx.stroke();
    });
}

function drawNodules(nodules) {
    // 保存到全局变量供 zoom 操作使用
    window.currentNodules = nodules;

    if (!originalImage) return;

    // 清空画布
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // 始终绘制肺部轮廓（不管有没有结节）
    if (window.currentLungContours && window.currentLungContours.length > 0) {
        drawLungContours();
    }

    // 无结节时不绘制标注
    if (!nodules || nodules.length === 0) return;

    // 计算缩放比例（从原图到显示尺寸）
    const scaleX = displayWidth > 0 ? displayWidth / originalImage.width : 1;
    const scaleY = displayHeight > 0 ? displayHeight / originalImage.height : 1;

    // 绘制每个结节（使用矩形框）
    nodules.forEach((nodule) => {
        const x = nodule.x * scaleX;
        const y = nodule.y * scaleY;
        const halfSize = nodule.radius * Math.min(scaleX, scaleY);

        const color = getConfidenceColor(nodule.confidence);

        // 绘制矩形边框
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);

        // 绘制标签 - 置信度已经是百分比形式
        const label = nodule.confidence > 1
            ? `${nodule.confidence.toFixed(1)}%`
            : `${(nodule.confidence * 100).toFixed(0)}%`;
        overlayCtx.font = 'bold 12px Arial';
        overlayCtx.fillStyle = color;
        overlayCtx.fillText(label, x + halfSize + 4, y - 4);
    });
}

// 清空覆盖层
function clearOverlay() {
    if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}

// 缩放控制
function zoomIn() {
    currentZoom = Math.min(currentZoom * 1.2, 5);
    resizeCanvas();
    if (window.currentNodules || (window.segmentationEnabled && window.currentLungContours)) {
        drawNodules(window.currentNodules);
    }
}

function zoomOut() {
    currentZoom = Math.max(currentZoom / 1.2, 0.2);
    resizeCanvas();
    if (window.currentNodules || (window.segmentationEnabled && window.currentLungContours)) {
        drawNodules(window.currentNodules);
    }
}

function resetZoom() {
    currentZoom = 1;
    panOffsetX = 0;
    panOffsetY = 0;
    resizeCanvas();
    if (window.currentNodules || (window.segmentationEnabled && window.currentLungContours)) {
        drawNodules(window.currentNodules);
    }
}

// 居中到指定结节
function centerOnNodule(nodule) {
    if (!originalImage || !nodule) return;

    const container = document.getElementById('imageContainer');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // 计算图像在容器中的位置
    const scaleX = containerWidth / originalImage.width;
    const scaleY = containerHeight / originalImage.height;
    const fitScale = Math.min(scaleX, scaleY, 1);

    const imgDisplayWidth = originalImage.width * fitScale * currentZoom;
    const imgDisplayHeight = originalImage.height * fitScale * currentZoom;

    // 计算图像左上角位置
    const imgLeft = (containerWidth - imgDisplayWidth) / 2;
    const imgTop = (containerHeight - imgDisplayHeight) / 2;

    // 计算结节在显示图像上的位置
    const noduleDisplayX = imgLeft + nodule.x * fitScale * currentZoom;
    const noduleDisplayY = imgTop + nodule.y * fitScale * currentZoom;

    // 计算居中所需的偏移量
    panOffsetX = containerWidth / 2 - noduleDisplayX;
    panOffsetY = containerHeight / 2 - noduleDisplayY;

    updateCanvasPosition();
}

// 导出当前带标记的图像
function exportCurrentImage() {
    if (!originalImage || !overlayCanvas) return;

    // 创建导出用的临时 canvas
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    exportCanvas.width = originalImage.width;
    exportCanvas.height = originalImage.height;

    // 绘制原图
    exportCtx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height);

    // 绘制标注（需要根据当前缩放比例换算）
    const scaleX = originalImage.width / displayWidth;
    const scaleY = originalImage.height / displayHeight;

    // 获取 overlay 的像素数据
    const overlayData = overlayCtx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);

    // 创建临时 canvas 来缩放标注
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = overlayCanvas.width;
    tempCanvas.height = overlayCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(overlayData, 0, 0);

    // 绘制缩放后的标注
    exportCtx.drawImage(tempCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height,
                       0, 0, originalImage.width, originalImage.height);

    // 创建下载链接
    const link = document.createElement('a');
    link.download = `nodule_detection_${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
}

// 导出所有带标记的图像（返回canvas供外部使用）
function getExportCanvasWithOverlay(img, nodules, canvasWidth, canvasHeight) {
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    exportCanvas.width = img.width;
    exportCanvas.height = img.height;

    // 绘制原图
    exportCtx.drawImage(img, 0, 0, img.width, img.height);

    // 计算缩放比例
    const scaleX = canvasWidth / img.width;
    const scaleY = canvasHeight / img.height;

    // 绘制结节标注
    nodules.forEach((nodule) => {
        const x = nodule.x * scaleX;
        const y = nodule.y * scaleY;
        const halfSize = nodule.radius * Math.min(scaleX, scaleY);

        const color = getConfidenceColor(nodule.confidence);

        exportCtx.strokeStyle = color;
        exportCtx.lineWidth = 2;
        exportCtx.strokeRect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);

        const label = nodule.confidence > 1
            ? `${nodule.confidence.toFixed(1)}%`
            : `${(nodule.confidence * 100).toFixed(0)}%`;
        exportCtx.font = 'bold 12px Arial';
        exportCtx.fillStyle = color;
        exportCtx.fillText(label, x + halfSize + 4, y - 4);
    });

    return exportCanvas;
}

// 在详情弹窗中绘制
function drawDetailCanvas(imageSrc, nodules) {
    const detailCanvas = document.getElementById('detailCanvas');
    if (!detailCanvas) {
        console.error('detailCanvas not found');
        return;
    }

    const ctx = detailCanvas.getContext('2d');
    if (!ctx) {
        console.error('Failed to get 2d context');
        return;
    }

    // 如果没有图片源，填充深色背景
    if (!imageSrc) {
        detailCanvas.width = 400;
        detailCanvas.height = 300;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 400, 300);
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.fillText('无图片', 170, 150);
        return;
    }

    const img = new Image();
    img.onerror = () => {
        detailCanvas.width = 400;
        detailCanvas.height = 300;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 400, 300);
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.fillText('图片加载失败', 150, 150);
    };
    img.onload = () => {
        if (img.width === 0 || img.height === 0) {
            img.width = 400;
            img.height = 300;
        }

        // 计算缩放比例
        const maxW = 700;
        const maxH = 500;
        let w = img.width;
        let h = img.height;

        if (w > maxW || h > maxH) {
            const r = Math.min(maxW / w, maxH / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
        }

        detailCanvas.width = w;
        detailCanvas.height = h;

        // 绘制图片
        ctx.drawImage(img, 0, 0, w, h);

        // 绘制标记
        const sx = w / img.width;
        const sy = h / img.height;

        nodules.forEach(n => {
            const x = n.x * sx;
            const y = n.y * sy;
            const size = n.radius * Math.min(sx, sy);
            const color = getConfidenceColor(n.confidence);

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - size, y - size, size * 2, size * 2);

            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = color;
            const conf = n.confidence > 1 ? n.confidence.toFixed(1) + '%' : (n.confidence * 100).toFixed(1) + '%';
            ctx.fillText(conf, x + size + 4, y - 4);
        });
    };
    img.src = imageSrc;
}

// 导出为全局函数
window.canvas = {
    init: initCanvas,
    loadImage,
    loadImageFromDataUrl,
    resizeCanvas,
    drawNodules,
    clearOverlay,
    drawDetailCanvas,
    drawLungContours,
    zoomIn,
    zoomOut,
    resetZoom,
    centerOnNodule,
    exportCurrentImage,
    getExportCanvasWithOverlay,
    getImageDataUrl: () => {
        if (imageCanvas && imageCanvas.width > 0) {
            return imageCanvas.toDataURL();
        }
        return null;
    }
};
