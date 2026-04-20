/**
 * API 模块 - 与后端 HTTP 服务通信
 */

const API_BASE = 'http://localhost:8080';

// 检测健康状态
async function checkHealth() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (response.ok) {
            const data = await response.json();
            return data;
        }
        return null;
    } catch (error) {
        console.error('Health check failed:', error);
        return null;
    }
}

// 上传图片进行检测
async function detectImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch(`${API_BASE}/api/detect`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Detection failed:', error);
        throw error;
    }
}

// 批量上传图片进行检测
async function detectImages(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('images', file);
    }

    try {
        const response = await fetch(`${API_BASE}/api/detect/batch`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Batch detection failed:', error);
        throw error;
    }
}

// 获取检测历史
async function getHistory() {
    try {
        const response = await fetch(`${API_BASE}/api/history`);
        if (response.ok) {
            const data = await response.json();
            return data.records || [];
        }
        return [];
    } catch (error) {
        console.error('Failed to load history:', error);
        return [];
    }
}

// 获取单条记录详情
async function getRecord(id) {
    try {
        const response = await fetch(`${API_BASE}/api/record/${id}`);
        if (response.ok) {
            const data = await response.json();
            return data.record;
        }
        return null;
    } catch (error) {
        console.error('Failed to load record:', error);
        return null;
    }
}

// 删除记录
async function deleteRecord(id) {
    try {
        const response = await fetch(`${API_BASE}/api/record/${id}`, {
            method: 'DELETE'
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to delete record:', error);
        return false;
    }
}

// 获取统计信息
async function getStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`);
        if (response.ok) {
            return await response.json();
        }
        return { total_detections: 0 };
    } catch (error) {
        console.error('Failed to load stats:', error);
        return { total_detections: 0 };
    }
}

// 清空所有历史记录
async function clearHistory() {
    try {
        const response = await fetch(`${API_BASE}/api/history`, {
            method: 'DELETE'
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to clear history:', error);
        return false;
    }
}

// 获取可用模型列表
async function getModels() {
    try {
        const response = await fetch(`${API_BASE}/api/models`);
        if (response.ok) {
            return await response.json();
        }
        return { models: [], current: null };
    } catch (error) {
        console.error('Failed to load models:', error);
        return { models: [], current: null };
    }
}

// 切换模型
async function switchModel(modelName) {
    try {
        const response = await fetch(`${API_BASE}/api/model/switch?model_name=${encodeURIComponent(modelName)}`, {
            method: 'POST'
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to switch model:', error);
        return false;
    }
}

// 获取设置
async function getSettings() {
    try {
        const response = await fetch(`${API_BASE}/api/settings`);
        if (response.ok) {
            return await response.json();
        }
        return { conf_threshold: 0.5, nms_threshold: 0.45 };
    } catch (error) {
        console.error('Failed to load settings:', error);
        return { conf_threshold: 0.5, nms_threshold: 0.45 };
    }
}

// 保存设置
async function saveSettings(settings) {
    try {
        const params = new URLSearchParams();
        if (settings.conf_threshold !== undefined) {
            params.append('conf_threshold', settings.conf_threshold);
        }
        if (settings.nms_threshold !== undefined) {
            params.append('nms_threshold', settings.nms_threshold);
        }
        const response = await fetch(`${API_BASE}/api/settings?${params.toString()}`, {
            method: 'POST'
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to save settings:', error);
        return false;
    }
}

// 导出为全局函数
window.api = {
    checkHealth,
    detectImage,
    detectImages,
    getHistory,
    getRecord,
    deleteRecord,
    getStats,
    clearHistory,
    getModels,
    switchModel,
    getSettings,
    saveSettings
};
