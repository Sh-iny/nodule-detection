"""
肺结节检测后端 - FastAPI HTTP 服务
"""

import os
import sys
import json
import base64
import tempfile
from pathlib import Path
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

from detector import Detector
from database import Database
from segmentor import Segmentor
import numpy as np
import cv2


# 判断是否为打包后的环境
def get_base_path():
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后的路径 - 使用可执行文件所在目录的 _internal 子文件夹
        return Path(sys.executable).parent / "_internal"
    else:
        # 开发环境路径
        return Path(__file__).parent.parent.resolve()

BASE_DIR = get_base_path()
MODEL_DIR = BASE_DIR / "backend" / "models"
MODEL_PATH = MODEL_DIR / "nodule_model.onnx"
FRONTEND_PATH = BASE_DIR / "frontend"

# 数据库路径：打包时放在exe同目录的data文件夹，开发时用项目data文件夹
if getattr(sys, 'frozen', False):
    # 打包环境：数据库放在 exe 同目录的 data 文件夹
    APP_DIR = Path(sys.executable).parent
    DB_PATH = APP_DIR / "data" / "nodules.db"
else:
    # 开发环境
    DB_PATH = BASE_DIR / "data" / "nodules.db"

# 确保数据目录存在
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# 当前设置
current_settings = {
    "conf_threshold": 0.5,
    "nms_threshold": 0.45
}

print(f"BASE_DIR: {BASE_DIR}")
print(f"FRONTEND_PATH: {FRONTEND_PATH}")
print(f"FRONTEND exists: {FRONTEND_PATH.exists()}")

# 初始化
app = FastAPI(title="Lung Nodule Detector")
detector = Detector()
segmentor = Segmentor()
db = Database(str(DB_PATH))

# 分割模型路径
SEGMENTOR_MODEL_PATH = MODEL_DIR / "unet_lung_smp.onnx"

# 挂载静态文件 - 必须在这里
if (FRONTEND_PATH / "css").exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_PATH / "css")), name="css")
if (FRONTEND_PATH / "js").exists():
    app.mount("/js", StaticFiles(directory=str(FRONTEND_PATH / "js")), name="js")
if (FRONTEND_PATH / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_PATH / "assets")), name="assets")


@app.on_event("startup")
async def startup():
    """启动时加载模型"""
    if MODEL_PATH.exists():
        if detector.load(str(MODEL_PATH)):
            print(f"Model loaded: {MODEL_PATH}")
        else:
            print("Warning: Model loading failed")
    else:
        print(f"Warning: Model not found at {MODEL_PATH}")

    # 加载分割模型
    if SEGMENTOR_MODEL_PATH.exists():
        if segmentor.load(str(SEGMENTOR_MODEL_PATH)):
            print(f"Segmentation model loaded: {SEGMENTOR_MODEL_PATH}")
        else:
            print("Warning: Segmentation model loading failed")
    else:
        print(f"Warning: Segmentation model not found at {SEGMENTOR_MODEL_PATH}")


@app.get("/", response_class=HTMLResponse)
async def root():
    """返回前端页面"""
    index_file = FRONTEND_PATH / "index.html"
    if index_file.exists():
        return index_file.read_text(encoding="utf-8")
    return "<h1>Frontend not found</h1>"


@app.get("/api/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "model_loaded": detector.session is not None
    }


@app.post("/api/detect")
async def detect(image: UploadFile = File(...), segmentation: bool = False):
    """上传单张图片进行检测，可选肺部分割"""
    if detector.session is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    if image.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = await image.read()

    suffix = ".jpg" if image.content_type == "image/jpeg" else ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        image_array = cv2.imread(tmp_path)
        lung_contours = []
        segmentation_elapsed_ms = 0

        if segmentation and segmentor.session is not None:
            # 先分割获取轮廓
            mask, segmentation_elapsed_ms = segmentor.segment(image_array)
            lung_contours = segmentor.get_lung_contours(mask)

            # 先用原图检测所有结节
            nodules, elapsed_ms = detector.detect(tmp_path)

            # 过滤：只保留位于或部分位于肺部区域的结节
            filtered_nodules = []
            for n in nodules:
                if _nodule_in_mask(n, mask):
                    filtered_nodules.append(n)
            nodules = filtered_nodules
        else:
            nodules, elapsed_ms = detector.detect(tmp_path)

        image_base64 = base64.b64encode(content).decode('utf-8')
        image_data = f"data:{image.content_type};base64,{image_base64}"

        result_json = json.dumps([n.to_dict() for n in nodules])
        batch_id = db.get_next_batch_id()
        record_id = db.insert(tmp_path, len(nodules), result_json, image_data, batch_id)

        return {
            "success": True,
            "nodules": [n.to_dict() for n in nodules],
            "count": len(nodules),
            "record_id": record_id,
            "batch_id": batch_id,
            "elapsed_ms": round(elapsed_ms, 2),
            "segmentation_applied": segmentation and segmentor.session is not None,
            "segmentation_elapsed_ms": round(segmentation_elapsed_ms, 2),
            "lung_contours": lung_contours
        }
    finally:
        os.unlink(tmp_path)


def _nodule_in_mask(nodule, mask: np.ndarray) -> bool:
    """检查结节中心是否在 mask 区域内，或与 mask 有交集"""
    x, y = int(nodule.x), int(nodule.y)
    r = int(nodule.radius)

    # 检查结节中心是否在 mask 内
    h, w = mask.shape[:2]
    if 0 <= x < w and 0 <= y < h:
        if mask[y, x] > 0:
            return True

    # 检查结节边界框与 mask 是否有交集
    x1 = max(0, x - r)
    y1 = max(0, y - r)
    x2 = min(w, x + r)
    y2 = min(h, y + r)

    if x1 >= x2 or y1 >= y2:
        return False

    # 检查 ROI 内是否有 mask 区域
    roi = mask[y1:y2, x1:x2]
    return np.any(roi > 0)


@app.post("/api/detect/batch")
async def detect_batch(images: List[UploadFile] = File(...), segmentation: bool = False):
    """批量上传图片进行检测，可选肺部分割"""
    if detector.session is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    batch_id = db.get_next_batch_id()
    results = []

    for image in images:
        if image.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
            continue

        content = await image.read()
        suffix = ".jpg" if image.content_type == "image/jpeg" else ".png"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            image_array = cv2.imread(tmp_path)
            lung_contours = []
            segmentation_elapsed_ms = 0

            if segmentation and segmentor.session is not None:
                mask, segmentation_elapsed_ms = segmentor.segment(image_array)
                lung_contours = segmentor.get_lung_contours(mask)

                nodules, elapsed_ms = detector.detect(tmp_path)

                filtered_nodules = []
                for n in nodules:
                    if _nodule_in_mask(n, mask):
                        filtered_nodules.append(n)
                nodules = filtered_nodules
            else:
                nodules, elapsed_ms = detector.detect(tmp_path)

            image_base64 = base64.b64encode(content).decode('utf-8')
            image_data = f"data:{image.content_type};base64,{image_base64}"
            result_json = json.dumps([n.to_dict() for n in nodules])
            record_id = db.insert(tmp_path, len(nodules), result_json, image_data, batch_id)

            results.append({
                "success": True,
                "nodules": [n.to_dict() for n in nodules],
                "count": len(nodules),
                "record_id": record_id,
                "batch_id": batch_id,
                "elapsed_ms": round(elapsed_ms, 2),
                "segmentation_applied": segmentation and segmentor.session is not None,
                "segmentation_elapsed_ms": round(segmentation_elapsed_ms, 2),
                "lung_contours": lung_contours
            })
        finally:
            os.unlink(tmp_path)

    return {
        "success": True,
        "batch_id": batch_id,
        "results": results
    }


@app.get("/api/history")
async def history():
    """获取检测历史"""
    records = db.get_all()
    return {
        "records": [r.to_dict() for r in records],
        "total": len(records)
    }


@app.get("/api/record/{record_id}")
async def get_record(record_id: int):
    """获取单条记录"""
    record = db.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")

    return {
        "success": True,
        "record": {
            "id": record.id,
            "image_path": record.image_path,
            "detection_time": record.detection_time,
            "nodule_count": record.nodule_count,
            "result_json": record.result_json,
            "image_data": record.image_data
        }
    }


@app.delete("/api/record/{record_id}")
async def delete_record(record_id: int):
    """删除记录"""
    success = db.delete(record_id)
    return {"success": success}


@app.delete("/api/history")
async def clear_history():
    """清空所有历史记录"""
    db.delete_all()
    return {"success": True}


@app.get("/api/stats")
async def stats():
    """获取统计信息"""
    return {
        "total_detections": db.count()
    }


@app.get("/api/models")
async def get_models():
    """获取可用模型列表"""
    models = Detector.get_available_models(str(MODEL_DIR))
    current = detector.current_model_path
    current_name = Path(current).name if current else None
    return {
        "models": models,
        "current": current_name
    }


@app.get("/api/settings")
async def get_settings():
    """获取当前设置"""
    return {
        "conf_threshold": detector.conf_threshold,
        "nms_threshold": detector.nms_threshold
    }


@app.post("/api/settings")
async def update_settings(conf_threshold: float = None, nms_threshold: float = None):
    """更新检测参数"""
    detector.set_thresholds(conf_threshold, nms_threshold)
    if conf_threshold is not None:
        current_settings["conf_threshold"] = conf_threshold
    if nms_threshold is not None:
        current_settings["nms_threshold"] = nms_threshold
    return {"success": True}


@app.post("/api/model/switch")
async def switch_model(model_name: str):
    """切换当前模型"""
    model_path = MODEL_DIR / model_name
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    if detector.switch_model(str(model_path)):
        return {"success": True, "model": model_name}
    raise HTTPException(status_code=500, detail="Failed to load model")


def main():
    """启动服务器"""
    print("=" * 50)
    print("Lung Nodule Detection Server")
    print("=" * 50)
    print(f"Model: {MODEL_PATH}")
    print(f"Database: {DB_PATH}")
    print(f"Frontend: {FRONTEND_PATH}")
    print("Server: http://localhost:8080")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
