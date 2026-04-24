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

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

from detector import Detector
from database import Database
from segmentor import Segmentor
from preprocessor import adaptive_preprocess_xray, calc_auto_params
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
DETECTION_MODEL_DIR = MODEL_DIR / "detection"
SEGMENTATION_MODEL_DIR = MODEL_DIR / "segmentation"
MODEL_PATH = DETECTION_MODEL_DIR / "nodule_model.onnx"
SEGMENTOR_MODEL_PATH = SEGMENTATION_MODEL_DIR / "unet_lung_smp.onnx"
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


@app.post("/api/preprocess/preview")
async def preprocess_preview(
    image: UploadFile = File(...),
    normalize: bool = Query(False),
    gamma: float = Query(None, ge=0.1, le=3.0),
    clip_limit: float = Query(None, ge=0.5, le=5.0),
    tophat: bool = Query(False),
    tophat_kernel: int = Query(15, ge=3, le=51),
    tophat_weight: float = Query(0.5, ge=0.0, le=2.0),
    sharpen: bool = Query(False),
    sharpen_weight: float = Query(1.5, ge=1.0, le=3.0),
):
    """预处理预览，只返回处理后的图像（不做检测）"""
    if image.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = await image.read()
    suffix = ".jpg" if image.content_type == "image/jpeg" else ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        image_array = cv2.imread(tmp_path)
        processed = adaptive_preprocess_xray(
            image_array,
            normalize=normalize,
            gamma=gamma,
            clip_limit=clip_limit,
            tophat=tophat,
            tophat_kernel=tophat_kernel,
            tophat_weight=tophat_weight,
            sharpen=sharpen,
            sharpen_weight=sharpen_weight,
        )

        # 返回处理后的图像（不保存文件）
        _, buffer = cv2.imencode('.jpg', processed)
        processed_bytes = buffer.tobytes()
        processed_image_data = f"data:image/jpeg;base64,{base64.b64encode(processed_bytes).decode('utf-8')}"

        return {"processed_image_data": processed_image_data}
    finally:
        os.unlink(tmp_path)


@app.post("/api/preprocess/calc")
async def preprocess_calc(image: UploadFile = File(...)):
    """根据图像计算预处理参数"""
    if image.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = await image.read()
    suffix = ".jpg" if image.content_type == "image/jpeg" else ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        image_array = cv2.imread(tmp_path)
        params = calc_auto_params(image_array)
        return params
    finally:
        os.unlink(tmp_path)


@app.post("/api/segment/preview")
async def segment_preview(
    image: UploadFile = File(...),
    preprocess: bool = Query(False),
    normalize: bool = Query(False),
    gamma: float = Query(None, ge=0.1, le=3.0),
    clip_limit: float = Query(None, ge=0.5, le=5.0),
    tophat: bool = Query(False),
    tophat_kernel: int = Query(15, ge=3, le=51),
    tophat_weight: float = Query(0.5, ge=0.0, le=2.0),
    sharpen: bool = Query(False),
    sharpen_weight: float = Query(1.5, ge=1.0, le=3.0),
):
    """肺部分割预览，只返回分割轮廓（不做检测）"""
    if segmentor.session is None:
        raise HTTPException(status_code=500, detail="Segmentor not loaded")

    if image.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = await image.read()
    suffix = ".jpg" if image.content_type == "image/jpeg" else ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        image_array = cv2.imread(tmp_path)

        # 预处理
        if preprocess:
            image_array = adaptive_preprocess_xray(
                image_array,
                normalize=normalize,
                gamma=gamma,
                clip_limit=clip_limit,
                tophat=tophat,
                tophat_kernel=tophat_kernel,
                tophat_weight=tophat_weight,
                sharpen=sharpen,
                sharpen_weight=sharpen_weight,
            )

        # 分割
        print(f"[SegmentPreview] preprocess={preprocess}, normalize={normalize}, gamma={gamma}, clip={clip_limit}")
        mask, elapsed_ms = segmentor.segment(image_array)
        lung_contours = segmentor.get_lung_contours(mask)
        print(f"[SegmentPreview] Got {len(lung_contours)} contours, mask sum={mask.sum()}, mask shape={mask.shape}")

        return {"lung_contours": lung_contours, "elapsed_ms": round(elapsed_ms, 2)}
    finally:
        os.unlink(tmp_path)


@app.post("/api/detect")
async def detect(
    image: UploadFile = File(...),
    preprocess: bool = Query(False),
    segmentation: bool = Query(False),
    normalize: bool = Query(False),
    gamma: float = Query(None, ge=0.1, le=3.0),
    clip_limit: float = Query(None, ge=0.5, le=5.0),
    tophat: bool = Query(False),
    tophat_kernel: int = Query(15, ge=3, le=51),
    tophat_weight: float = Query(0.5, ge=0.0, le=2.0),
    sharpen: bool = Query(False),
    sharpen_weight: float = Query(1.5, ge=1.0, le=3.0),
):
    """上传单张图片进行检测，可选预处理和肺部分割"""
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
        processed_image_data = None

        # 预处理
        if preprocess:
            image_array = adaptive_preprocess_xray(
                image_array,
                normalize=normalize,
                gamma=gamma,
                clip_limit=clip_limit,
                tophat=tophat,
                tophat_kernel=tophat_kernel,
                tophat_weight=tophat_weight,
                sharpen=sharpen,
                sharpen_weight=sharpen_weight,
            )
            # 保存预处理后的图片
            processed_path = tmp_path + ".processed.jpg"
            cv2.imwrite(processed_path, image_array)
            # 返回处理后的图片
            with open(processed_path, 'rb') as f:
                processed_bytes = f.read()
            processed_image_data = f"data:image/jpeg;base64,{base64.b64encode(processed_bytes).decode('utf-8')}"

        # 肺部分割
        if segmentation and segmentor.session is not None:
            mask, segmentation_elapsed_ms = segmentor.segment(image_array)
            lung_contours = segmentor.get_lung_contours(mask)

            # 用预处理后的图检测所有结节
            detect_path = processed_path if preprocess else tmp_path
            nodules, elapsed_ms = detector.detect(detect_path)

            # 过滤：只保留位于或部分位于肺部区域的结节
            filtered_nodules = []
            for n in nodules:
                if _nodule_in_mask(n, mask):
                    filtered_nodules.append(n)
            nodules = filtered_nodules

            if preprocess and os.path.exists(processed_path):
                os.unlink(processed_path)
        else:
            detect_path = processed_path if preprocess else tmp_path
            nodules, elapsed_ms = detector.detect(detect_path)
            if preprocess and os.path.exists(processed_path):
                os.unlink(processed_path)

        image_base64 = base64.b64encode(content).decode('utf-8')
        image_data = f"data:{image.content_type};base64,{image_base64}"

        result_json = json.dumps([n.to_dict() for n in nodules])
        batch_id = db.get_next_batch_id()
        record_id = db.insert(tmp_path, len(nodules), result_json, image_data, batch_id)

        # 计算实际使用的参数（用于前端显示）
        gray = cv2.cvtColor(cv2.imread(tmp_path), cv2.COLOR_BGR2GRAY)
        mean = np.mean(gray)
        std = np.std(gray)
        print(f"[Detect] image mean={mean:.1f}, std={std:.1f}")
        actual_gamma = gamma if gamma is not None else (1.4 if mean > 180 else 1.2 if mean > 150 else 0.8 if mean < 80 else 1.0)
        actual_clip = clip_limit if clip_limit is not None else (3.0 if std < 40 else 2.0 if std < 60 else 1.5)

        result = {
            "success": True,
            "nodules": [n.to_dict() for n in nodules],
            "count": len(nodules),
            "record_id": record_id,
            "batch_id": batch_id,
            "elapsed_ms": round(elapsed_ms, 2),
            "segmentation_applied": segmentation and segmentor.session is not None,
            "segmentation_elapsed_ms": round(segmentation_elapsed_ms, 2),
            "lung_contours": lung_contours,
            "processed_image_data": processed_image_data,
        }

        # 仅在启用预处理时返回计算出的参数值
        if preprocess:
            result["applied_gamma"] = round(actual_gamma, 2)
            result["applied_clip_limit"] = round(actual_clip, 2)

        return result
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
async def detect_batch(
    images: List[UploadFile] = File(...),
    preprocess: bool = Query(False),
    segmentation: bool = Query(False),
    normalize: bool = Query(False),
    gamma: float = Query(None, ge=0.1, le=3.0),
    clip_limit: float = Query(None, ge=0.5, le=5.0),
    tophat: bool = Query(False),
    tophat_kernel: int = Query(15, ge=3, le=51),
    tophat_weight: float = Query(0.5, ge=0.0, le=2.0),
    sharpen: bool = Query(False),
    sharpen_weight: float = Query(1.5, ge=1.0, le=3.0),
):
    """批量上传图片进行检测，可选预处理和肺部分割"""
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

            # 预处理
            processed_image_data = None
            processed_path = None
            if preprocess:
                image_array = adaptive_preprocess_xray(
                    image_array,
                    normalize=normalize,
                    gamma=gamma,
                    clip_limit=clip_limit,
                    tophat=tophat,
                    tophat_kernel=tophat_kernel,
                    tophat_weight=tophat_weight,
                    sharpen=sharpen,
                    sharpen_weight=sharpen_weight,
                )
                processed_path = tmp_path + ".processed.jpg"
                cv2.imwrite(processed_path, image_array)
                # 立即读取处理后的图像数据（在删除文件之前）
                with open(processed_path, 'rb') as f:
                    processed_bytes = f.read()
                processed_image_data = f"data:image/jpeg;base64,{base64.b64encode(processed_bytes).decode('utf-8')}"

            # 肺部分割
            if segmentation and segmentor.session is not None:
                print(f"[Batch] Segmentation enabled, session: {segmentor.session is not None}")
                mask, segmentation_elapsed_ms = segmentor.segment(image_array)
                lung_contours = segmentor.get_lung_contours(mask)
                print(f"[Batch] Got {len(lung_contours)} lung contours, mask sum: {mask.sum()}")

                detect_path = processed_path if preprocess else tmp_path
                nodules, elapsed_ms = detector.detect(detect_path)

                filtered_nodules = []
                for n in nodules:
                    if _nodule_in_mask(n, mask):
                        filtered_nodules.append(n)
                nodules = filtered_nodules

                if preprocess and os.path.exists(processed_path):
                    os.unlink(processed_path)
            else:
                detect_path = processed_path if preprocess else tmp_path
                nodules, elapsed_ms = detector.detect(detect_path)
                if preprocess and os.path.exists(processed_path):
                    os.unlink(processed_path)

            image_base64 = base64.b64encode(content).decode('utf-8')
            image_data = f"data:{image.content_type};base64,{image_base64}"
            result_json = json.dumps([n.to_dict() for n in nodules])
            record_id = db.insert(tmp_path, len(nodules), result_json, image_data, batch_id)

            result_item = {
                "success": True,
                "nodules": [n.to_dict() for n in nodules],
                "count": len(nodules),
                "record_id": record_id,
                "batch_id": batch_id,
                "elapsed_ms": round(elapsed_ms, 2),
                "segmentation_applied": segmentation and segmentor.session is not None,
                "segmentation_elapsed_ms": round(segmentation_elapsed_ms, 2),
                "lung_contours": lung_contours,
                "processed_image_data": processed_image_data,
            }

            # 仅在启用预处理时返回计算出的参数值
            if preprocess:
                gray = cv2.cvtColor(cv2.imread(tmp_path), cv2.COLOR_BGR2GRAY)
                mean = np.mean(gray)
                std = np.std(gray)
                actual_gamma = gamma if gamma is not None else (1.4 if mean > 180 else 1.2 if mean > 150 else 0.8 if mean < 80 else 1.0)
                actual_clip = clip_limit if clip_limit is not None else (3.0 if std < 40 else 2.0 if std < 60 else 1.5)
                result_item["applied_gamma"] = round(actual_gamma, 2)
                result_item["applied_clip_limit"] = round(actual_clip, 2)

            results.append(result_item)
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
    detection_models = Detector.get_available_models(str(DETECTION_MODEL_DIR))
    detection_current = Path(detector.current_model_path).name if detector.current_model_path else None

    segmentation_models = Segmentor.get_available_models(str(SEGMENTATION_MODEL_DIR))
    segmentation_current = Path(segmentor.current_model_path).name if segmentor.current_model_path else None

    return {
        "detection_models": detection_models,
        "detection_current": detection_current,
        "segmentation_models": segmentation_models,
        "segmentation_current": segmentation_current
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
    """切换当前检测模型"""
    model_path = DETECTION_MODEL_DIR / model_name
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")
    if detector.switch_model(str(model_path)):
        return {"success": True, "model": model_name}
    raise HTTPException(status_code=500, detail="Failed to load model")


@app.post("/api/segmentation/switch")
async def switch_segmentation_model(model_name: str):
    """切换当前分割模型"""
    model_path = SEGMENTATION_MODEL_DIR / model_name
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Segmentation model not found")
    if segmentor.load(str(model_path)):
        return {"success": True, "model": model_name}
    raise HTTPException(status_code=500, detail="Failed to load segmentation model")


def main():
    """启动服务器"""
    print("=" * 50)
    print("Lung Nodule Detection Server")
    print("=" * 50)
    print(f"Detection Model: {MODEL_PATH}")
    print(f"Segmentation Model: {SEGMENTOR_MODEL_PATH}")
    print(f"Database: {DB_PATH}")
    print(f"Frontend: {FRONTEND_PATH}")
    print("Server: http://localhost:8080")
    print("=" * 50)

    uvicorn.run(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
