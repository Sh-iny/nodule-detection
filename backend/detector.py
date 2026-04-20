"""
肺结节检测后端 - 检测器模块
使用 ONNX Runtime 进行模型推理
"""

import numpy as np
import cv2
from typing import List, Tuple
import onnxruntime as ort


class Nodule:
    """结节检测结果"""
    def __init__(self, x: int, y: int, radius: float, confidence: float):
        self.x = x
        self.y = y
        self.radius = radius
        self.confidence = confidence

    def to_dict(self):
        return {
            "x": self.x,
            "y": self.y,
            "radius": round(self.radius, 2),
            "confidence": round(self.confidence, 4)
        }


class Detector:
    """YOLO 肺结节检测器"""

    def __init__(self):
        self.session = None
        self.input_name = None
        self.output_name = None
        self.img_size = 640
        self.conf_threshold = 0.5
        self.nms_threshold = 0.45
        self.current_model_path = None

    @staticmethod
    def get_available_models(models_dir: str) -> list:
        """扫描目录获取可用模型列表"""
        import os
        if not os.path.exists(models_dir):
            return []
        return [f for f in os.listdir(models_dir) if f.endswith('.onnx')]

    def switch_model(self, model_path: str) -> bool:
        """切换当前使用的模型"""
        return self.load(model_path)

    def set_thresholds(self, conf_threshold: float = None, nms_threshold: float = None):
        """设置检测阈值"""
        if conf_threshold is not None:
            self.conf_threshold = conf_threshold
        if nms_threshold is not None:
            self.nms_threshold = nms_threshold

    def load(self, model_path: str) -> bool:
        """加载 ONNX 模型"""
        try:
            self.session = ort.InferenceSession(
                model_path,
                providers=['CPUExecutionProvider']
            )

            # 获取输入输出名称
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name

            print(f"Model loaded: {model_path}")
            print(f"Input: {self.input_name}, Output: {self.output_name}")
            self.current_model_path = model_path
            return True
        except Exception as e:
            print(f"Failed to load model: {e}")
            return False

    def detect(self, image_path: str) -> Tuple[List[Nodule], float]:
        """检测图片中的肺结节，返回(结节列表,耗时毫秒)"""
        import time
        start_time = time.perf_counter()
        nodules = []

        if self.session is None:
            print("Model not loaded")
            return nodules, 0

        # 读取图像
        image = cv2.imread(image_path)
        if image is None:
            print(f"Failed to read image: {image_path}")
            return nodules, 0

        orig_h, orig_w = image.shape[:2]

        # 预处理
        preprocessed = self._preprocess(image)

        # 推理
        outputs = self.session.run(
            [self.output_name],
            {self.input_name: preprocessed}
        )

        # 后处理
        nodules = self._postprocess(outputs[0], orig_w, orig_h)

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        return nodules, elapsed_ms

    def _preprocess(self, image: np.ndarray) -> np.ndarray:
        """图像预处理"""
        # 缩放到 640x640
        resized = cv2.resize(image, (self.img_size, self.img_size))

        # 归一化 [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # HWC -> CHW
        transposed = np.transpose(normalized, (2, 0, 1))

        # 增加 batch 维度
        batched = np.expand_dims(transposed, axis=0)

        return batched.astype(np.float32)

    def _compute_iou(self, box1, box2):
        """计算两个框的 IoU（矩形框）"""
        x1_min = box1[0] - box1[2] / 2
        y1_min = box1[1] - box1[3] / 2
        x1_max = box1[0] + box1[2] / 2
        y1_max = box1[1] + box1[3] / 2

        x2_min = box2[0] - box2[2] / 2
        y2_min = box2[1] - box2[3] / 2
        x2_max = box2[0] + box2[2] / 2
        y2_max = box2[1] + box2[3] / 2

        # 计算交集
        inter_x_min = max(x1_min, x2_min)
        inter_y_min = max(y1_min, y2_min)
        inter_x_max = min(x1_max, x2_max)
        inter_y_max = min(y1_max, y2_max)

        if inter_x_max <= inter_x_min or inter_y_max <= inter_y_min:
            return 0.0

        inter_area = (inter_x_max - inter_x_min) * (inter_y_max - inter_y_min)

        # 计算并集
        box1_area = box1[2] * box1[3]
        box2_area = box2[2] * box2[3]
        union_area = box1_area + box2_area - inter_area

        return inter_area / union_area if union_area > 0 else 0.0

    def _nms(self, boxes, scores, iou_threshold=0.45):
        """非极大值抑制"""
        if len(boxes) == 0:
            return []

        # 按置信度排序（降序）
        indices = np.argsort(scores)[::-1]

        keep = []
        while len(indices) > 0:
            current = indices[0]
            keep.append(current)

            if len(indices) == 1:
                break

            # 计算当前框与其余框的 IoU
            ious = [self._compute_iou(boxes[current], boxes[i]) for i in indices[1:]]

            # 保留 IoU 小于阈值的框
            indices = indices[1:][np.array(ious) < iou_threshold]

        return keep

    def _postprocess(self, output: np.ndarray, orig_w: int, orig_h: int) -> List[Nodule]:
        """后处理解析检测结果"""
        # YOLOv8 输出: (batch, 5, num_predictions)
        # 5 = x_center, y_center, width, height, confidence
        predictions = output[0]  # shape: (5, 8400)

        # 转置为 (num_predictions, 5)
        predictions = predictions.T

        scale_x = orig_w / self.img_size
        scale_y = orig_h / self.img_size

        boxes = []
        scores = []

        for pred in predictions:
            confidence = pred[4]

            if confidence < self.conf_threshold:
                continue

            # 坐标转换
            x_center = pred[0] * scale_x
            y_center = pred[1] * scale_y
            width = pred[2] * scale_x
            height = pred[3] * scale_y

            boxes.append([x_center, y_center, width, height])
            scores.append(confidence)

        if len(boxes) == 0:
            return []

        boxes = np.array(boxes)
        scores = np.array(scores)

        # 应用 NMS
        keep_indices = self._nms(boxes, scores, iou_threshold=self.nms_threshold)

        # 构建结果
        nodules = []
        for idx in keep_indices:
            x_center, y_center, width, height = boxes[idx]
            radius = (width + height) / 4.0
            nodules.append(Nodule(
                x=int(x_center),
                y=int(y_center),
                radius=radius,
                confidence=float(scores[idx])
            ))

        return nodules
