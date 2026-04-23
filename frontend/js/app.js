/**
 * 应用主模块
 */

// 当前状态 - 批量检测
let files = [];                    // 文件列表
let currentIndex = 0;              // 当前图片索引
let batchResults = [];              // 批量检测结果
let batchId = null;                // 当前批次ID
let currentNodules = [];
let statsChart = null;
let preprocessEnabled = false;    // 自适应预处理状态
let segmentationEnabled = false;   // 肺部分割状态
let preprocessAutoMode = true;     // 预处理参数自动模式（自动根据图像计算）

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    initDropZone();
    initEventListeners();
    initStatsChart();
    loadHistory();
    loadStats();
    checkServerConnection();
});

// 初始化拖拽区
function initDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    if (!dropZone || !fileInput) return;

    // 文件选择 - 支持多选
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);
            // 延迟清空input，避免浏览器行为异常
            setTimeout(() => { e.target.value = ''; }, 0);
            handleFiles(newFiles);
        }
    });

    // 拖拽事件
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 预览函数 - 使用当前滑块参数预览图像
let isPreviewLoading = false;

async function previewWithParams() {
    if (files.length === 0 || !originalImage) return;
    if (preprocessAutoMode) return;  // 自动模式下不预览

    const gamma = parseFloat(document.getElementById('gammaSlider').value);
    const clipLimit = parseFloat(document.getElementById('clipSlider').value);

    isPreviewLoading = true;
    showPreviewLoading(true);

    try {
        const result = await api.previewPreprocess(files[currentIndex], gamma, clipLimit);
        if (result.processed_image_data) {
            await canvas.loadImageFromDataUrl(result.processed_image_data);
        }
    } catch (error) {
        console.error('Preview failed:', error);
    } finally {
        isPreviewLoading = false;
        showPreviewLoading(false);
    }
}

function showPreviewLoading(show) {
    const overlay = document.getElementById('previewOverlay');
    if (overlay) {
        if (show) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }
}

// 防抖版本的预览（300ms 防抖）
const debouncedPreview = debounce(previewWithParams, 300);

// 初始化事件监听
function initEventListeners() {
    // 检测按钮
    const btnDetect = document.getElementById('btnDetect');
    if (btnDetect) {
        btnDetect.addEventListener('click', startDetection);
    }

    // 肺部分割勾选 - 切换时对所有图片处理并显示轮廓
    const processToggle = document.getElementById('processModuleToggle');
    if (processToggle) {
        processToggle.addEventListener('change', async (e) => {
            window.segmentationEnabled = e.target.checked;
            segmentationEnabled = e.target.checked;

            if (files.length === 0) return;

            // 保存当前的结节数据
            const nodulesToDraw = currentNodules || [];

            if (e.target.checked) {
                // 勾选时：对所有图片获取分割轮廓
                showPreviewLoading(true);
                try {
                    let gamma = null;
                    let clipLimit = null;
                    if (!preprocessAutoMode) {
                        gamma = parseFloat(document.getElementById('gammaSlider').value);
                        clipLimit = parseFloat(document.getElementById('clipSlider').value);
                    }
                    // 对所有图片处理
                    for (let i = 0; i < files.length; i++) {
                        const result = await api.previewSegmentation(files[i], preprocessEnabled, gamma, clipLimit);
                        batchResults[i] = batchResults[i] || {};
                        batchResults[i].lung_contours = result.lung_contours || [];
                    }
                    window.currentLungContours = batchResults[currentIndex]?.lung_contours || [];
                } catch (error) {
                    console.error('Segmentation preview failed:', error);
                    window.currentLungContours = [];
                }
                showPreviewLoading(false);
            } else {
                // 取消勾选时：隐藏轮廓
                for (let i = 0; i < files.length; i++) {
                    if (batchResults[i]) batchResults[i].lung_contours = [];
                }
                window.currentLungContours = [];
            }

            // 统一重绘
            if (originalImage) {
                canvas.drawNodules(nodulesToDraw);
            }
        });
    }

    // 自适应预处理勾选 - 显示/隐藏参数面板，并自动处理所有图像
    const preprocessToggle = document.getElementById('preprocessToggle');
    if (preprocessToggle) {
        preprocessToggle.addEventListener('change', async (e) => {
            window.preprocessEnabled = e.target.checked;
            preprocessEnabled = e.target.checked;
            const paramsPanel = document.getElementById('preprocessParams');
            if (paramsPanel) {
                paramsPanel.classList.toggle('hidden', !e.target.checked);
            }

            if (e.target.checked) {
                // 勾选时：用自动参数预览，按钮保持灰色
                if (files.length > 0) {
                    showPreviewLoading(true);
                    try {
                        // 获取自动参数
                        const params = await api.calcPreprocessParams(files[currentIndex]);
                        const gamma = params.gamma || 1.0;
                        const clipLimit = params.clip_limit || 2.0;

                        // 更新UI - 按钮保持灰色（自动模式）
                        document.getElementById('gammaSlider').value = gamma;
                        document.getElementById('gammaValue').textContent = gamma;
                        document.getElementById('clipSlider').value = clipLimit;
                        document.getElementById('clipValue').textContent = clipLimit;
                        document.getElementById('gammaAutoBtn').classList.remove('active');
                        document.getElementById('clipAutoBtn').classList.remove('active');
                        preprocessAutoMode = true; // 自动模式

                        // 对所有图片预览
                        for (let i = 0; i < files.length; i++) {
                            const result = await api.previewPreprocess(files[i], gamma, clipLimit);
                            if (!batchResults[i]) batchResults[i] = {};
                            batchResults[i].processed_image_data = result.processed_image_data || null;
                        }

                        // 加载当前图片的预处理结果
                        const result = batchResults[currentIndex];
                        if (result && result.processed_image_data) {
                            await canvas.loadImageFromDataUrl(result.processed_image_data);
                            canvas.drawNodules(currentNodules);
                        }
                    } catch (error) {
                        console.error('Preprocess preview failed:', error);
                    }
                    showPreviewLoading(false);
                }
            } else {
                // 取消勾选时：恢复原始图像并重绘
                preprocessAutoMode = false;
                document.getElementById('gammaValue').textContent = '-';
                document.getElementById('clipValue').textContent = '-';
                document.getElementById('gammaAutoBtn').classList.remove('active');
                document.getElementById('clipAutoBtn').classList.remove('active');
                if (files.length > 0) {
                    // 清除所有预处理结果
                    for (let i = 0; i < files.length; i++) {
                        if (batchResults[i]) batchResults[i].processed_image_data = null;
                    }
                    await canvas.loadImage(files[currentIndex]);
                    canvas.drawNodules(currentNodules);
                }
            }
        });
    }

    // Gamma 滑块 - 手动调整时开启手动模式，按钮变蓝
    const gammaSlider = document.getElementById('gammaSlider');
    if (gammaSlider) {
        gammaSlider.addEventListener('input', (e) => {
            preprocessAutoMode = false;
            document.getElementById('gammaValue').textContent = e.target.value;
            document.getElementById('gammaAutoBtn').classList.add('active'); // 变蓝
            debouncedPreview();
        });
    }

    // CLAHE Clip 滑块 - 手动调整时开启手动模式，按钮变蓝
    const clipSlider = document.getElementById('clipSlider');
    if (clipSlider) {
        clipSlider.addEventListener('input', (e) => {
            preprocessAutoMode = false;
            document.getElementById('clipValue').textContent = e.target.value;
            document.getElementById('clipAutoBtn').classList.add('active'); // 变蓝
            debouncedPreview();
        });
    }
}

// 处理文件列表
async function handleFiles(fileList) {
    // 验证文件类型
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/dicom'];

    // 过滤有效文件
    files = [];
    for (const file of fileList) {
        if (!validTypes.includes(file.type)) {
            continue;
        }
        if (file.size > 50 * 1024 * 1024) {
            alert(`文件 ${file.name} 超过50MB限制`);
            continue;
        }
        files.push(file);
    }

    if (files.length === 0) {
        alert('没有有效的图片文件');
        return;
    }

    // 重置状态
    currentIndex = 0;
    // 初始化 batchResults 数组，每个元素都是空对象
    batchResults = new Array(files.length).fill(null).map(() => ({}));
    batchId = null;

    // 加载第一张图片
    try {
        await loadImageByIndex(0);
    } catch (error) {
        console.error('Load image error:', error);
        alert('图片加载失败');
        return;
    }

    // 显示导航
    updateImageNavigation();

    document.getElementById('btnDetect').disabled = false;
    document.getElementById('resultPanel').innerHTML = '<p class="placeholder-text">点击"开始检测"进行肺结节检测</p>';
}

// 加载指定索引的图片
async function loadImageByIndex(index) {
    if (index < 0 || index >= files.length) return;

    currentIndex = index;
    const file = files[index];

    try {
        // 如果有预处理后的图片数据，使用它
        const result = batchResults[index];
        if (result && result.processed_image_data) {
            await canvas.loadImageFromDataUrl(result.processed_image_data);
        } else {
            await canvas.loadImage(file);
        }

        // 更新肺部轮廓（肺部分割模式）
        if (result && result.lung_contours && result.lung_contours.length > 0) {
            window.currentLungContours = result.lung_contours;
        } else {
            window.currentLungContours = [];
        }
        updateImageCounter();

        // 加载完成后重绘轮廓
        afterImageLoad();

        // 显示当前图片对应的检测结果（如果有结节数据）
        if (batchResults[index] && batchResults[index].nodules) {
            displayResult(batchResults[index], index);
        } else {
            // 只有分割轮廓或预览图像时，不清空overlay
            currentNodules = [];
            if (!(result && result.lung_contours && result.lung_contours.length > 0)) {
                canvas.clearOverlay();
            }
            document.getElementById('resultPanel').innerHTML = '<p class="placeholder-text">点击"开始检测"进行肺结节检测</p>';
        }
    } catch (error) {
        console.error('Failed to load image:', error);
        alert('图片加载失败');
    }
}

// 在图片加载完成后绘制覆盖物
function afterImageLoad() {
    if (!originalImage) return;
    // 重绘肺部轮廓（如果有）
    if (window.currentLungContours && window.currentLungContours.length > 0) {
        canvas.drawLungContours();
    }
}

// 更新图片导航显示
function updateImageNavigation() {
    const nav = document.getElementById('imageNavigation');
    if (files.length > 1) {
        nav.classList.remove('hidden');
        updateImageCounter();
    } else {
        nav.classList.add('hidden');
    }
}

// 更新图片计数器
function updateImageCounter() {
    const counter = document.getElementById('imageCounter');
    if (counter) {
        counter.textContent = `${currentIndex + 1} / ${files.length}`;
    }
}

// 上一张
function prevImage() {
    if (currentIndex > 0) {
        loadImageByIndex(currentIndex - 1);
    }
}

// 下一张
function nextImage() {
    if (currentIndex < files.length - 1) {
        loadImageByIndex(currentIndex + 1);
    }
}

// 开始检测
let isDetecting = false;

async function startDetection() {
    if (files.length === 0) {
        alert('请先上传图片');
        return;
    }

    if (isDetecting) return;
    isDetecting = true;

    const btnDetect = document.getElementById('btnDetect');
    const loadingOverlay = document.getElementById('loadingOverlay');

    btnDetect.disabled = true;
    loadingOverlay.classList.remove('hidden');

    try {
        // 获取预处理参数（自动模式下传 null 让后端计算）
        let gamma = null;
        let clipLimit = null;
        if (!preprocessAutoMode) {
            const gammaSlider = document.getElementById('gammaSlider');
            const clipSlider = document.getElementById('clipSlider');
            gamma = gammaSlider ? parseFloat(gammaSlider.value) : null;
            clipLimit = clipSlider ? parseFloat(clipSlider.value) : null;
        }

        // 批量检测 - 使用一次请求发送所有图片
        let statusText = '检测中...';
        if (preprocessEnabled && segmentationEnabled) {
            statusText = '预处理+分割+检测中...';
        } else if (preprocessEnabled) {
            statusText = '预处理+检测中...';
        } else if (segmentationEnabled) {
            statusText = '分割+检测中...';
        }
        document.querySelector('#loadingOverlay p').textContent = statusText;
        const batchResponse = await api.detectImages(files, preprocessEnabled, segmentationEnabled, gamma, clipLimit);

        if (batchResponse.success) {
            batchResults = batchResponse.results;
            batchId = batchResponse.batch_id;

            // 先更新参数面板和轮廓（仅在启用预处理时更新）
            const firstResult = batchResults[0];
            if (firstResult) {
                if (preprocessEnabled) {
                    if ('applied_gamma' in firstResult) {
                        const gv = document.getElementById('gammaValue');
                        const gs = document.getElementById('gammaSlider');
                        if (gv) gv.textContent = firstResult.applied_gamma;
                        if (gs) gs.value = firstResult.applied_gamma;
                    }
                    if ('applied_clip_limit' in firstResult) {
                        const cv = document.getElementById('clipValue');
                        const cs = document.getElementById('clipSlider');
                        if (cv) cv.textContent = firstResult.applied_clip_limit;
                        if (cs) cs.value = firstResult.applied_clip_limit;
                        document.getElementById('preprocessParams').classList.remove('hidden');
                    }
                }
                // 确保预处理勾选状态
                document.getElementById('preprocessToggle').checked = preprocessEnabled;
                // 设置肺部轮廓
                window.currentLungContours = firstResult.lung_contours || [];
            }

            // 显示第一张的结果
            currentIndex = 0;
            await loadImageByIndex(0);
            displayResult(batchResults[0], 0);

            loadHistory();  // 刷新历史记录
            loadStats();    // 刷新统计
        } else {
            alert('检测失败');
        }
    } catch (error) {
        console.error('Detection error:', error);
        alert('检测请求失败，请确保后端服务正在运行');
    } finally {
        btnDetect.disabled = false;
        loadingOverlay.classList.add('hidden');
        isDetecting = false;
    }
}

// 显示检测结果
function displayResult(result, imageIndex) {
    const nodules = result.nodules || [];
    const elapsedMs = result.elapsed_ms || 0;
    const resultPanel = document.getElementById('resultPanel');

    // 保存当前结节列表
    currentNodules = nodules;

    // 保存肺部轮廓供 canvas 使用
    window.currentLungContours = result.lung_contours || [];

    // 如果是批量检测，显示总体信息
    const isBatch = batchResults.length > 1;
    const totalImages = batchResults.length;
    const totalNodulesAll = batchResults.reduce((sum, r) => sum + (r.nodules ? r.nodules.length : 0), 0);

    if (!result.success) {
        resultPanel.innerHTML = `
            <p class="placeholder-text">检测失败: ${result.error || '未知错误'}</p>
            ${isBatch ? `<p class="batch-summary">第 ${imageIndex + 1} / ${totalImages} 张图片</p>` : ''}
        `;
        canvas.clearOverlay();
        return;
    }

    if (nodules.length === 0) {
        resultPanel.innerHTML = `
            <p class="placeholder-text">未检测到肺结节</p>
            <p class="elapsed-time">检测耗时: ${elapsedMs.toFixed(2)} ms</p>
            ${isBatch ? `<p class="batch-summary">第 ${imageIndex + 1} / ${totalImages} 张 · 共 ${totalNodulesAll} 个结节</p>` : ''}
        `;
    } else {
        const totalConf = nodules.reduce((sum, n) => sum + (n.confidence > 1 ? n.confidence : n.confidence * 100), 0) / nodules.length;
        resultPanel.innerHTML = `
            <div class="result-summary">
                <span class="result-count">检测到 <strong>${nodules.length}</strong> 个结节</span>
                <span class="result-avg">平均置信度: <strong>${totalConf.toFixed(1)}%</strong></span>
            </div>
            <p class="elapsed-time">检测耗时: ${elapsedMs.toFixed(2)} ms</p>
            ${isBatch ? `<p class="batch-summary">第 ${imageIndex + 1} / ${totalImages} 张 · 共 ${totalNodulesAll} 个结节</p>` : ''}
            <div class="result-list">
                ${nodules.map((nodule, index) => {
                    const confPercent = nodule.confidence > 1 ? nodule.confidence : nodule.confidence * 100;
                    const color = confPercent >= 90 ? '#22c55e' : confPercent >= 70 ? '#f59e0b' : '#ef4444';
                    return `
                    <div class="nodule-card" onclick="centerOnNodule(${index})">
                        <div class="nodule-header">
                            <span class="nodule-index" style="background:${color}">#${index + 1}</span>
                            <span class="nodule-conf" style="color:${color}">${confPercent.toFixed(1)}%</span>
                        </div>
                        <div class="nodule-detail">
                            <span>中心: (${nodule.x}, ${nodule.y})</span>
                            <span>半径: ${nodule.radius.toFixed(1)} px</span>
                        </div>
                    </div>
                `}).join('')}
            </div>
        `;

        // 在图像上绘制结节标记
        canvas.drawNodules(nodules);
    }
}

// 清除图像
function clearImage() {
    files = [];
    currentIndex = 0;
    batchResults = [];
    batchId = null;
    currentNodules = [];

    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';

    document.getElementById('btnDetect').disabled = true;
    document.getElementById('imagePlaceholder').classList.remove('hidden');
    document.getElementById('resultPanel').innerHTML = '<p class="placeholder-text">请上传图片并点击检测</p>';
    canvas.clearOverlay();

    // 隐藏导航
    document.getElementById('imageNavigation').classList.add('hidden');

    // 清空图像画布
    if (imageCtx && imageCanvas) {
        imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    }

    if (originalImage) {
        originalImage = null;
    }
}

// 居中到指定结节
function centerOnNodule(index) {
    if (!currentNodules || !currentNodules[index]) return;
    canvas.centerOnNodule(currentNodules[index]);
}

// 检查服务器连接
async function checkServerConnection() {
    const statusEl = document.getElementById('serverStatus');

    try {
        const health = await api.checkHealth();
        if (health && health.status === 'ok') {
            statusEl.textContent = '已连接';
            statusEl.classList.add('connected');
        } else {
            statusEl.textContent = '未连接';
            statusEl.classList.remove('connected');
        }
    } catch (error) {
        statusEl.textContent = '未连接';
        statusEl.classList.remove('connected');
    }

    // 每30秒检查一次
    setTimeout(checkServerConnection, 30000);
}

// 加载历史记录
async function loadHistory() {
    const historyList = document.getElementById('historyList');

    try {
        const records = await api.getHistory();

        if (records.length === 0) {
            historyList.innerHTML = '<p class="placeholder-text">暂无检测记录</p>';
            return;
        }

        // 按 batch_id 分组
        const batchMap = new Map();
        records.forEach(record => {
            const batchId = record.batch_id || 0;
            if (!batchMap.has(batchId)) {
                batchMap.set(batchId, []);
            }
            batchMap.get(batchId).push(record);
        });

        // 按批次显示（batch_id 大的在前，即最新的在前）
        const batches = Array.from(batchMap.values()).sort((a, b) => {
            return (b[0].batch_id || 0) - (a[0].batch_id || 0);
        });

        historyList.innerHTML = batches.map(batch => {
            const totalImages = batch.length;
            const totalNodules = batch.reduce((sum, r) => sum + r.nodule_count, 0);
            const firstRecord = batch[0];
            const time = formatTime(firstRecord.detection_time);

            if (totalImages === 1) {
                return `
                <div class="history-item" onclick="showRecordDetail(${firstRecord.id})">
                    <div class="history-info">
                        <span class="history-count">检测到 ${totalNodules} 个结节</span>
                        <span class="history-time">${time}</span>
                    </div>
                    <button class="history-delete" onclick="event.stopPropagation(); removeRecord(${firstRecord.id})">
                        删除
                    </button>
                </div>
            `;
            } else {
                // 批量记录，点击展开
                return `
                <div class="history-item batch-item" onclick="toggleBatch(this, ${JSON.stringify(batch.map(r => r.id))})">
                    <div class="history-info">
                        <span class="history-count">检测 ${totalImages} 张图片，${totalNodules} 个结节</span>
                        <span class="history-time">${time}</span>
                    </div>
                    <button class="history-delete" onclick="event.stopPropagation(); removeBatch([${batch.map(r => r.id).join(',')}])">
                        删除
                    </button>
                </div>
                <div class="batch-records hidden">
                    ${batch.map(record => `
                        <div class="history-sub-item" onclick="showRecordDetail(${record.id})">
                            <span>图片 ${batch.indexOf(record) + 1}: ${record.nodule_count} 个结节</span>
                        </div>
                    `).join('')}
                </div>
            `;
            }
        }).join('');
    } catch (error) {
        console.error('Failed to load history:', error);
    }
}

// 展开/收起批量记录
function toggleBatch(element, recordIds) {
    const batchRecords = element.nextElementSibling;
    if (batchRecords && batchRecords.classList.contains('batch-records')) {
        batchRecords.classList.toggle('hidden');
    }
}

// 删除整个批次
async function removeBatch(recordIds) {
    if (!confirm(`确定要删除这 ${recordIds.length} 条记录吗？`)) return;

    try {
        for (const id of recordIds) {
            await api.deleteRecord(id);
        }
        loadHistory();
        loadStats();
    } catch (error) {
        console.error('Failed to delete batch:', error);
        alert('删除失败');
    }
}

// 显示记录详情
async function showRecordDetail(id) {
    const modal = document.getElementById('detailModal');
    const detailInfo = document.getElementById('detailInfo');

    try {
        const record = await api.getRecord(id);
        if (!record) {
            alert('记录不存在');
            return;
        }

        // 解析结果
        let nodules = [];
        try {
            nodules = JSON.parse(record.result_json);
        } catch (e) {
            console.error('Failed to parse result_json:', e);
        }

        // 格式化时间
        const timeStr = formatTime(record.detection_time);

        detailInfo.innerHTML = `
            <h4>检测信息</h4>
            <p>检测时间: ${timeStr}</p>
            <p>结节数量: ${record.nodule_count}</p>
            <p>记录ID: ${record.id}</p>
            <h4>结节详情</h4>
            ${nodules.map((n, i) => {
                const conf = n.confidence > 1 ? n.confidence : n.confidence * 100;
                return `<p>#${i + 1}: 位置 (${n.x}, ${n.y}), 半径 ${n.radius.toFixed(1)}, 置信度 ${conf.toFixed(1)}%</p>`;
            }).join('')}
        `;

        modal.classList.remove('hidden');

        // 使用 API 返回的图片数据
        const imgDataUrl = record.image_data;

        // 绘制到详情 canvas
        setTimeout(() => {
            canvas.drawDetailCanvas(imgDataUrl, nodules);
        }, 100);
    } catch (error) {
        console.error('Failed to load record:', error);
        alert('加载记录详情失败');
    }
}

// 删除记录
async function removeRecord(id) {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
        const success = await api.deleteRecord(id);
        if (success) {
            loadHistory();
            loadStats();
        } else {
            alert('删除失败');
        }
    } catch (error) {
        console.error('Failed to delete record:', error);
        alert('删除失败');
    }
}

// 关闭详情弹窗
function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    const content = modal.querySelector('.modal-content');
    if (modal && content) {
        modal.style.animation = 'modalFadeOut 0.3s var(--ease-standard) forwards';
        content.style.animation = 'modalSlideOut 0.3s var(--ease-standard) forwards';
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.animation = '';
            content.style.animation = '';
        }, 300);
    } else if (modal) {
        modal.classList.add('hidden');
    }
}

// 清空所有历史记录
async function clearAllHistory() {
    if (!confirm('确定要清空所有检测历史吗？此操作不可恢复。')) {
        return;
    }

    try {
        const success = await api.clearHistory();
        if (success) {
            loadHistory();
            loadStats();
        } else {
            alert('清空失败');
        }
    } catch (error) {
        console.error('Failed to clear history:', error);
        alert('清空失败');
    }
}

// 加载统计信息
async function loadStats() {
    try {
        const stats = await api.getStats();
        document.getElementById('totalDetections').textContent = stats.total_detections || 0;

        // 获取历史记录计算累计结节数
        const history = await api.getHistory();
        const totalNodules = history.reduce((sum, r) => sum + r.nodule_count, 0);
        document.getElementById('totalNodules').textContent = totalNodules;

        // 更新图表
        if (statsChart) {
            // 动态获取最近7天，今天在最右边
            const today = new Date();
            const days = [];
            const counts = new Array(7).fill(0);

            // 生成最近7天的日期（今天在最后）
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                days.push(`${d.getMonth() + 1}/${d.getDate()}`);
            }

            // 统计每天的检测数量
            history.forEach(record => {
                const date = new Date(record.detection_time);
                // 找出这条记录对应的日期索引
                const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
                const idx = days.indexOf(dateStr);
                if (idx !== -1) {
                    counts[idx]++;
                }
            });

            // 计算Y轴间隔，最多6个刻度
            const maxCount = Math.max(...counts, 0);
            const maxTicks = 6;
            const interval = Math.ceil(maxCount / (maxTicks - 1)) || 1;

            statsChart.setOption({
                xAxis: {
                    data: days
                },
                yAxis: {
                    type: 'value',
                    min: 0,
                    max: maxCount + interval,
                    interval: interval,
                    axisLabel: {
                        fontSize: 10,
                        formatter: (val) => Math.round(val)
                    }
                },
                series: [{
                    data: counts
                }]
            });
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// 初始化统计图表
function initStatsChart() {
    const chartDom = document.getElementById('statsChart');
    if (!chartDom) return;

    // 如果已存在，先销毁
    if (statsChart) {
        statsChart.dispose();
    }

    statsChart = echarts.init(chartDom);

    // 动态获取最近7天，今天在最右边
    const today = new Date();
    const initDays = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        initDays.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }

    const option = {
        tooltip: {
            trigger: 'axis'
        },
        grid: {
            left: 40,
            right: 20,
            top: 20,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: initDays,
            axisLabel: {
                fontSize: 10
            }
        },
        yAxis: {
            type: 'value',
            min: 0,
            max: 6,
            interval: 1,
            axisLabel: {
                fontSize: 10,
                formatter: (val) => Math.round(val)
            }
        },
        series: [{
            name: '检测次数',
            type: 'bar',
            data: [0, 0, 0, 0, 0, 0, 0],
            itemStyle: {
                color: '#2563eb'
            }
        }]
    };

    statsChart.setOption(option);

    // 响应窗口大小变化
    window.addEventListener('resize', () => {
        if (statsChart) {
            statsChart.resize();
        }
    });
}

// 格式化时间
function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== 设置相关 ====================

let currentTheme = localStorage.getItem('theme') || 'dark';

// 初始化设置
async function initSettings() {
    // 应用保存的主题
    applyTheme(currentTheme);

    // 加载检测设置
    await loadDetectionSettings();

    // 加载模型列表
    await loadModelList();
}

// 应用主题
function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('theme', theme);

    // 新设计：默认是深色主题，light-theme 类用于浅色模式
    if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
    } else {
        document.documentElement.classList.remove('light-theme');
    }

    // 更新主题选择框
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.value = theme;
    }

    // 图表需要重新渲染
    if (statsChart) {
        setTimeout(() => statsChart.resize(), 100);
    }
}

// 加载检测参数设置
async function loadDetectionSettings() {
    try {
        const settings = await api.getSettings();
        const confThreshold = document.getElementById('confThreshold');
        const nmsThreshold = document.getElementById('nmsThreshold');
        const confValue = document.getElementById('confValue');
        const nmsValue = document.getElementById('nmsValue');

        if (confThreshold && settings.conf_threshold !== undefined) {
            confThreshold.value = settings.conf_threshold;
            if (confValue) confValue.textContent = settings.conf_threshold.toFixed(2);
        }
        if (nmsThreshold && settings.nms_threshold !== undefined) {
            nmsThreshold.value = settings.nms_threshold;
            if (nmsValue) nmsValue.textContent = settings.nms_threshold.toFixed(2);
        }
    } catch (error) {
        console.error('Failed to load detection settings:', error);
    }
}

// 加载模型列表
async function loadModelList() {
    try {
        const data = await api.getModels();

        // 检测模型
        const detectionModelSelect = document.getElementById('detectionModelSelect');
        if (detectionModelSelect) {
            detectionModelSelect.innerHTML = '';
            if (data.detection_models && data.detection_models.length > 0) {
                data.detection_models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    if (model === data.detection_current) {
                        option.selected = true;
                    }
                    detectionModelSelect.appendChild(option);
                });
            } else {
                detectionModelSelect.innerHTML = '<option value="">无可用检测模型</option>';
            }
        }

        // 分割模型
        const segmentationModelSelect = document.getElementById('segmentationModelSelect');
        if (segmentationModelSelect) {
            segmentationModelSelect.innerHTML = '';
            if (data.segmentation_models && data.segmentation_models.length > 0) {
                data.segmentation_models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    if (model === data.segmentation_current) {
                        option.selected = true;
                    }
                    segmentationModelSelect.appendChild(option);
                });
            } else {
                segmentationModelSelect.innerHTML = '<option value="">无可用分割模型</option>';
            }
        }
    } catch (error) {
        console.error('Failed to load models:', error);
    }
}

// 重置 Gamma 为自动（让后端根据图像自动计算）
function resetGamma() {
    if (!document.getElementById('gammaAutoBtn').classList.contains('active')) return;
    preprocessAutoMode = true;
    // 恢复原始图像
    if (files.length > 0) {
        canvas.loadImage(files[currentIndex]);
    }
    document.getElementById('gammaValue').textContent = '-';
    document.getElementById('gammaAutoBtn').classList.remove('active');
}

// 重置 CLAHE Clip 为自动（让后端根据图像自动计算）
function resetClip() {
    if (!document.getElementById('clipAutoBtn').classList.contains('active')) return;
    preprocessAutoMode = true;
    // 恢复原始图像
    if (files.length > 0) {
        canvas.loadImage(files[currentIndex]);
    }
    document.getElementById('clipValue').textContent = '-';
    document.getElementById('clipAutoBtn').classList.remove('active');
}

// 点击自动按钮时获取后端计算的参数并预览
async function applyAutoParams(paramType) {
    if (files.length === 0) return;

    try {
        const params = await api.calcPreprocessParams(files[currentIndex]);

        if (paramType === 'gamma' && params.gamma !== undefined) {
            const gammaSlider = document.getElementById('gammaSlider');
            const gammaValue = document.getElementById('gammaValue');
            if (gammaSlider) gammaSlider.value = params.gamma;
            if (gammaValue) gammaValue.textContent = params.gamma;
            document.getElementById('gammaAutoBtn').classList.remove('active');
        } else if (paramType === 'clip' && params.clip_limit !== undefined) {
            const clipSlider = document.getElementById('clipSlider');
            const clipValue = document.getElementById('clipValue');
            if (clipSlider) clipSlider.value = params.clip_limit;
            if (clipValue) clipValue.textContent = params.clip_limit;
            document.getElementById('clipAutoBtn').classList.remove('active');
        } else if (paramType === 'all') {
            // 全部自动
            if (params.gamma !== undefined) {
                const gammaSlider = document.getElementById('gammaSlider');
                const gammaValue = document.getElementById('gammaValue');
                if (gammaSlider) gammaSlider.value = params.gamma;
                if (gammaValue) gammaValue.textContent = params.gamma;
            }
            if (params.clip_limit !== undefined) {
                const clipSlider = document.getElementById('clipSlider');
                const clipValue = document.getElementById('clipValue');
                if (clipSlider) clipSlider.value = params.clip_limit;
                if (clipValue) clipValue.textContent = params.clip_limit;
            }
            document.getElementById('gammaAutoBtn').classList.remove('active');
            document.getElementById('clipAutoBtn').classList.remove('active');
        }

        preprocessAutoMode = true;

        // 使用计算出的参数预览图像
        const gamma = parseFloat(document.getElementById('gammaSlider').value);
        const clipLimit = parseFloat(document.getElementById('clipSlider').value);

        showPreviewLoading(true);
        const result = await api.previewPreprocess(files[currentIndex], gamma, clipLimit);
        if (result.processed_image_data) {
            await canvas.loadImageFromDataUrl(result.processed_image_data);
        }
        showPreviewLoading(false);
    } catch (error) {
        console.error('Failed to get auto params:', error);
        showPreviewLoading(false);
    }
}

// 打开设置弹窗
async function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('hidden');
        await loadDetectionSettings();
        await loadModelList();
    }
}

// 关闭设置弹窗
function closeSettings() {
    const modal = document.getElementById('settingsModal');
    const content = modal ? modal.querySelector('.modal-content') : null;
    if (modal && content) {
        modal.style.animation = 'modalFadeOut 0.3s var(--ease-standard) forwards';
        content.style.animation = 'modalSlideOut 0.3s var(--ease-standard) forwards';
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.animation = '';
            content.style.animation = '';
        }, 300);
    } else if (modal) {
        modal.classList.add('hidden');
    }
}

// 保存设置
async function saveSettings() {
    const confThreshold = parseFloat(document.getElementById('confThreshold').value);
    const nmsThreshold = parseFloat(document.getElementById('nmsThreshold').value);
    const theme = document.getElementById('themeSelect').value;

    // 检测模型
    const detectionModelSelect = document.getElementById('detectionModelSelect');
    const selectedDetectionModel = detectionModelSelect ? detectionModelSelect.value : null;

    // 分割模型
    const segmentationModelSelect = document.getElementById('segmentationModelSelect');
    const selectedSegmentationModel = segmentationModelSelect ? segmentationModelSelect.value : null;

    // 保存检测参数到后端
    try {
        await api.saveSettings({ conf_threshold: confThreshold, nms_threshold: nmsThreshold });
    } catch (error) {
        console.error('Failed to save detection settings:', error);
    }

    // 切换检测模型
    if (selectedDetectionModel) {
        await api.switchModel(selectedDetectionModel);
    }

    // 切换分割模型
    if (selectedSegmentationModel) {
        await api.switchSegmentationModel(selectedSegmentationModel);
    }

    // 应用主题
    applyTheme(theme);

    // 关闭弹窗
    closeSettings();
}

// 监听设置滑块变化
document.addEventListener('DOMContentLoaded', () => {
    const confThreshold = document.getElementById('confThreshold');
    const nmsThreshold = document.getElementById('nmsThreshold');

    if (confThreshold) {
        confThreshold.addEventListener('input', (e) => {
            const confValue = document.getElementById('confValue');
            if (confValue) confValue.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    if (nmsThreshold) {
        nmsThreshold.addEventListener('input', (e) => {
            const nmsValue = document.getElementById('nmsValue');
            if (nmsValue) nmsValue.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    // 初始化设置
    initSettings();
});

// 导出为全局函数
window.loadHistory = loadHistory;
window.startDetection = startDetection;
window.clearImage = clearImage;
window.centerOnNodule = centerOnNodule;
window.prevImage = prevImage;
window.nextImage = nextImage;
window.zoomIn = () => canvas.zoomIn();
window.zoomOut = () => canvas.zoomOut();
window.resetZoom = () => canvas.resetZoom();
window.exportCurrentImage = () => canvas.exportCurrentImage();
window.showRecordDetail = showRecordDetail;
window.removeRecord = removeRecord;
window.removeBatch = removeBatch;
window.toggleBatch = toggleBatch;
window.closeDetailModal = closeDetailModal;
window.clearAllHistory = clearAllHistory;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.resetGamma = resetGamma;
window.resetClip = resetClip;
window.applyAutoParams = applyAutoParams;
Object.defineProperty(window, 'currentNodules', {
    get: () => currentNodules,
    set: (v) => { currentNodules = v; }
});
Object.defineProperty(window, 'preprocessEnabled', {
    get: () => preprocessEnabled,
    set: (v) => { preprocessEnabled = v; }
});
Object.defineProperty(window, 'segmentationEnabled', {
    get: () => segmentationEnabled,
    set: (v) => { segmentationEnabled = v; }
});
Object.defineProperty(window, 'preprocessAutoMode', {
    get: () => preprocessAutoMode,
    set: (v) => { preprocessAutoMode = v; }
});

// 导出所有带标注的图片为ZIP
window.exportAllImages = async function() {
    if (!files || files.length === 0 || !batchResults || batchResults.length === 0) {
        alert('没有可导出的图片');
        return;
    }

    const zip = new JSZip();
    let processed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = batchResults[i];

        if (!result) continue;

        try {
            const img = await loadImageAsCanvas(file);
            const nodules = result.nodules || [];

            // 计算显示尺寸（用于换算标注位置）
            const container = document.getElementById('imageContainer');
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            const scaleX = containerWidth / img.width;
            const scaleY = containerHeight / img.height;
            const fitScale = Math.min(scaleX, scaleY, 1);

            const exportCanvas = canvas.getExportCanvasWithOverlay(img, nodules, img.width, img.height);
            const dataUrl = exportCanvas.toDataURL('image/png');
            const base64 = dataUrl.split(',')[1];

            zip.file(`nodule_detection_${i + 1}.png`, base64, { base64: true });
            processed++;
        } catch (e) {
            console.error(`导出第 ${i + 1} 张图片失败:`, e);
        }
    }

    if (processed === 0) {
        alert('没有可导出的图片');
        return;
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `nodule_detection_all_${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
};

// 加载图片为 Image 对象
function loadImageAsCanvas(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
