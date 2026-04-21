"""
自适应图像预处理模块 - 根据每张 X 光自动调节增强参数
"""
import cv2
import numpy as np


def adaptive_preprocess_xray(image):
    """
    自适应X光增强
    根据图像的亮度和对比度动态调整 gamma 和 CLAHE 强度
    """
    # 转灰度
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 计算统计量
    mean = np.mean(gray)
    std = np.std(gray)

    # 自适应 Gamma（亮度修正）
    if mean > 180:
        gamma = 1.4   # 过亮 → 压暗
    elif mean > 150:
        gamma = 1.2
    elif mean < 80:
        gamma = 0.8   # 过暗 → 提亮
    else:
        gamma = 1.0   # 正常

    # Gamma 校正
    img_gamma = np.power(gray / 255.0, gamma) * 255.0
    img_gamma = img_gamma.astype(np.uint8)

    # 自适应 CLAHE（对比度增强）
    if std < 40:
        clip = 3.0   # 对比度低 → 强增强
    elif std < 60:
        clip = 2.0
    else:
        clip = 1.5   # 对比度高 → 少增强

    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    img_clahe = clahe.apply(img_gamma)

    # 轻微标准化（防止极端情况）
    img = img_clahe.astype(np.float32)
    img = (img - img.mean()) / (img.std() + 1e-6)
    img = (img * 0.2 + 0.5) * 255
    img = np.clip(img, 0, 255).astype(np.uint8)

    # 转回 3 通道（YOLO 需要）
    img_out = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

    return img_out
