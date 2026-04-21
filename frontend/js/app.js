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
let segmentationEnabled = false;   // 图像处理模块状态

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

// 初始化事件监听
function initEventListeners() {
    // 检测按钮
    const btnDetect = document.getElementById('btnDetect');
    if (btnDetect) {
        btnDetect.addEventListener('click', startDetection);
    }

    // 肺部分割勾选 - 切换时立即更新显示
    const processToggle = document.getElementById('processModuleToggle');
    if (processToggle) {
        processToggle.addEventListener('change', (e) => {
            window.segmentationEnabled = e.target.checked;
            segmentationEnabled = e.target.checked;
            // 如果当前有图像，重新显示（带或不带轮廓）
            if (files.length > 0 && batchResults.length > 0) {
                if (segmentationEnabled) {
                    window.currentLungContours = batchResults[currentIndex].lung_contours || [];
                } else {
                    window.currentLungContours = [];
                }
                canvas.drawNodules(currentNodules);
            }
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
    batchResults = [];
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
        await canvas.loadImage(file);
        updateImageCounter();

        // 显示当前图片对应的检测结果（如果有）
        if (batchResults[index]) {
            displayResult(batchResults[index], index);
        } else {
            canvas.clearOverlay();
            document.getElementById('resultPanel').innerHTML = '<p class="placeholder-text">点击"开始检测"进行肺结节检测</p>';
        }
    } catch (error) {
        console.error('Failed to load image:', error);
        alert('图片加载失败');
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
        // 批量检测 - 使用一次请求发送所有图片
        const statusText = segmentationEnabled ? '分割+检测中...' : '检测中...';
        document.querySelector('#loadingOverlay p').textContent = statusText;
        const batchResponse = await api.detectImages(files, segmentationEnabled);

        if (batchResponse.success) {
            batchResults = batchResponse.results;
            batchId = batchResponse.batch_id;

            // 显示第一张的结果
            currentIndex = 0;
            loadImageByIndex(0);
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
    document.getElementById('detailModal').classList.add('hidden');
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

            // 计算Y轴间隔，最多10个刻度
            const maxCount = Math.max(...counts, 0);
            const maxTicks = 10;
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

let currentTheme = localStorage.getItem('theme') || 'light';

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

    if (theme === 'dark') {
        document.documentElement.classList.add('dark-theme');
    } else {
        document.documentElement.classList.remove('dark-theme');
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
        const modelSelect = document.getElementById('modelSelect');

        if (!modelSelect) return;

        modelSelect.innerHTML = '';

        if (data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === data.current) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });
        } else {
            modelSelect.innerHTML = '<option value="">无可用模型</option>';
        }
    } catch (error) {
        console.error('Failed to load models:', error);
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
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 保存设置
async function saveSettings() {
    const confThreshold = parseFloat(document.getElementById('confThreshold').value);
    const nmsThreshold = parseFloat(document.getElementById('nmsThreshold').value);
    const theme = document.getElementById('themeSelect').value;
    const modelSelect = document.getElementById('modelSelect');
    const selectedModel = modelSelect ? modelSelect.value : null;

    // 保存检测参数到后端
    try {
        await api.saveSettings({ conf_threshold: confThreshold, nms_threshold: nmsThreshold });
    } catch (error) {
        console.error('Failed to save detection settings:', error);
    }

    // 切换模型
    if (selectedModel) {
        const currentModel = modelSelect.options[modelSelect.selectedIndex].text;
        // 只有模型改变时才切换
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
Object.defineProperty(window, 'currentNodules', {
    get: () => currentNodules,
    set: (v) => { currentNodules = v; }
});
Object.defineProperty(window, 'segmentationEnabled', {
    get: () => segmentationEnabled,
    set: (v) => { segmentationEnabled = v; }
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
