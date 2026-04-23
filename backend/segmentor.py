"""
肺部分割模块 - UNet 分割模型推理
"""
import numpy as np
import cv2
import onnxruntime as ort
import time
from pathlib import Path
from typing import Tuple, List


class Segmentor:
    """UNet 肺部分割器"""

    def __init__(self):
        self.session = None
        self.input_name = None
        self.output_name = None
        self.img_size = 512
        self.current_model_path = None

    @staticmethod
    def get_available_models(models_dir: str) -> list:
        """获取可用分割模型列表"""
        models_path = Path(models_dir)
        if not models_path.exists():
            return []
        return sorted([f.name for f in models_path.glob("*.onnx")])

    def load(self, model_path: str) -> bool:
        """加载 ONNX 分割模型"""
        try:
            self.session = ort.InferenceSession(
                model_path,
                providers=['CPUExecutionProvider']
            )
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            self.current_model_path = model_path
            print(f"Segmentation model loaded: {model_path}")
            return True
        except Exception as e:
            print(f"Failed to load segmentation model: {e}")
            return False

    def segment(self, image: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        对输入图像进行肺部分割
        Returns: (mask, elapsed_ms) where mask is a binary mask (H, W)
        """
        start_time = time.perf_counter()

        orig_h, orig_w = image.shape[:2]

        preprocessed = self._preprocess(image)

        outputs = self.session.run(
            [self.output_name],
            {self.input_name: preprocessed}
        )

        mask = self._postprocess(outputs[0], orig_h, orig_w)

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        return mask, elapsed_ms

    def segment_from_file(self, image_path: str) -> Tuple[np.ndarray, float]:
        """从文件路径进行分割"""
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Failed to read image: {image_path}")
        return self.segment(image)

    def _preprocess(self, image: np.ndarray) -> np.ndarray:
        """预处理: 转灰度、缩放、归一化"""
        # 转为灰度图
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image

        resized = cv2.resize(gray, (self.img_size, self.img_size))
        normalized = resized.astype(np.float32) / 255.0
        # (H, W) -> (1, H, W) -> (1, 1, H, W)
        batched = normalized.reshape(1, 1, self.img_size, self.img_size)
        return batched.astype(np.float32)

    def _postprocess(self, output: np.ndarray, orig_h: int, orig_w: int) -> np.ndarray:
        """
        后处理: 将输出转换为二值化 mask
        """
        if output.ndim == 4:
            output = output[0]

        if output.shape[0] == 2:
            output = output[0]
        else:
            output = output[0]

        mask = cv2.resize(output, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        binary_mask = (mask > 0.5).astype(np.uint8)

        return binary_mask

    def get_lung_contours(self, mask: np.ndarray) -> List[List[List[int]]]:
        """从二值 mask 中提取肺轮廓"""
        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        contour_list = []
        for contour in contours:
            points = [[int(p[0][0]), int(p[0][1])] for p in contour]
            contour_list.append(points)

        return contour_list

    def apply_mask(self, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """将 mask 应用到原图（保留肺部区域）"""
        if mask.ndim == 3:
            mask = mask[:, :, 0]

        mask_3ch = cv2.merge([mask, mask, mask])
        masked_image = cv2.bitwise_and(image, mask_3ch)

        return masked_image

    def get_overlay_image(self, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """返回带肺部边界绘制的图像（BGR）"""
        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        overlay = image.copy()
        cv2.drawContours(overlay, contours, -1, (0, 255, 0), 2)

        return overlay
