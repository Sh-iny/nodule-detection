"""
自适应图像预处理模块 - 多阶段图像增强流水线
处理顺序：归一化 → Gamma → CLAHE → Top-hat → 锐化
"""
import cv2
import numpy as np


def normalize_percentile(gray, low=2, high=98):
    """
    Percentile 归一化 - 统一数据分布，比 Gamma 更稳定

    Args:
        gray: 输入灰度图
        low, high: 百分位数范围（默认 2%-98%）
    Returns:
        归一化后的 uint8 灰度图
    """
    p_low, p_high = np.percentile(gray, (low, high))
    img = np.clip((gray - p_low) / (p_high - p_low + 1e-6), 0, 1)
    img = (img * 255).astype(np.uint8)
    return img


def apply_gamma(gray, gamma):
    """Gamma 校正"""
    img = np.power(gray / 255.0, gamma) * 255.0
    return img.astype(np.uint8)


def apply_clahe(gray, clip_limit=2.0, tile_grid_size=(8, 8)):
    """CLAHE 对比度增强"""
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    return clahe.apply(gray)


def apply_tophat(gray, kernel_size=15, weight=0.5):
    """
    Top-hat 变换 - 专门增强小结节（亮细节）

    Args:
        gray: 输入灰度图
        kernel_size: 结构元素大小（椭圆核）
        weight: 融合权重，0.0~1.0
    Returns:
        融合后的 uint8 灰度图
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    enhanced = cv2.addWeighted(gray, 1.0, tophat, weight, 0)
    return enhanced


def unsharp_mask(gray, weight=1.5):
    """
    Unsharp Mask 锐化 - 边缘增强

    Args:
        gray: 输入灰度图
        weight: 锐化强度，1.0=无效果，建议 1.0~2.0
    Returns:
        锐化后的 uint8 灰度图
    """
    # sigma=2 产生更强的模糊，使 (原图 - 模糊) 的边缘差异更明显
    blur = cv2.GaussianBlur(gray, (0, 0), 2)
    sharpened = cv2.addWeighted(gray, weight, blur, 1.0 - weight, 0)
    return sharpened


def adaptive_preprocess_xray(
    image,
    normalize=False,
    gamma=None,
    clip_limit=None,
    tophat=False,
    tophat_kernel=15,
    tophat_weight=0.5,
    sharpen=False,
    sharpen_weight=1.5,
):
    """
    多阶段 X 光图像增强流水线

    处理顺序：归一化 → Gamma → CLAHE → Top-hat → 锐化

    Args:
        image: 输入图像 (BGR格式)
        normalize: 是否启用 percentile 归一化
        gamma: 手动 gamma 值，None 时自动计算（仅在 gamma 开关开启时生效）
        clip_limit: 手动 CLAHE clip limit，None 时自动计算（仅在 CLAHE 开关开启时生效）
        tophat: 是否启用 top-hat 增强
        tophat_kernel: top-hat 结构元素大小
        tophat_weight: top-hat 融合权重
        sharpen: 是否启用 unsharp mask 锐化
        sharpen_weight: 锐化强度
    Returns:
        处理后的 BGR 图像
    """
    # 转灰度
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 计算统计量（用于 auto 参数）
    mean = np.mean(gray)
    std = np.std(gray)

    # 阶段 1：归一化
    if normalize:
        gray = normalize_percentile(gray)
        # 归一化后重新计算统计量
        mean = np.mean(gray)
        std = np.std(gray)

    # 阶段 2：Gamma 校正
    if gamma is not None:
        gray = apply_gamma(gray, gamma)

    # 阶段 3：CLAHE
    if clip_limit is not None:
        gray = apply_clahe(gray, clip_limit=clip_limit)

    # 阶段 4：Top-hat
    if tophat:
        gray = apply_tophat(gray, kernel_size=tophat_kernel, weight=tophat_weight)

    # 阶段 5：锐化
    if sharpen:
        gray = unsharp_mask(gray, weight=sharpen_weight)

    # 转回 BGR
    img_out = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    return img_out


def calc_auto_params(image):
    """
    根据图像自动计算各处理方法的推荐参数

    Args:
        image: 输入图像 (BGR格式)
    Returns:
        dict: {
            'normalize': bool,
            'gamma': float or None,
            'clip_limit': float or None,
            'tophat_kernel': int,
            'tophat_weight': float,
            'sharpen_weight': float,
        }
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    mean = np.mean(gray)
    std = np.std(gray)

    # 归一化：默认推荐开启
    normalize = True

    # Gamma：仅在未归一化时根据亮度计算；归一化后数据已均衡，gamma 不需要
    # 但为了兼容旧行为，仍计算一个值（前端可决定是否使用）
    if mean > 180:
        gamma = 1.4
    elif mean > 150:
        gamma = 1.2
    elif mean < 80:
        gamma = 0.8
    else:
        gamma = 1.0

    # CLAHE：根据对比度
    if std < 40:
        clip_limit = 3.0
    elif std < 60:
        clip_limit = 2.0
    else:
        clip_limit = 1.5

    # Top-hat：根据图像尺寸建议核大小
    min_dim = min(h, w)
    if min_dim >= 1024:
        tophat_kernel = 21
    elif min_dim >= 512:
        tophat_kernel = 15
    else:
        tophat_kernel = 9

    tophat_weight = 0.5
    sharpen_weight = 1.5

    return {
        "normalize": normalize,
        "gamma": gamma,
        "clip_limit": clip_limit,
        "tophat_kernel": tophat_kernel,
        "tophat_weight": tophat_weight,
        "sharpen_weight": sharpen_weight,
    }
