"""
模型转换脚本 - 将 PyTorch YOLO 模型转换为 ONNX 格式
用法: python convert_model.py --input model.pt --output model.onnx
"""

import argparse
import torch
import sys

def convert_yolo_to_onnx(input_path, output_path, img_size=640):
    """
    将 YOLO 模型转换为 ONNX 格式

    Args:
        input_path: 输入 .pt 模型路径
        output_path: 输出 .onnx 模型路径
        img_size: 输入图像大小
    """
    print(f"Loading model from: {input_path}")

    try:
        # 加载 PyTorch 模型
        model = torch.load(input_path, map_location='cpu', weights_only=False)

        # YOLO 模型格式: {'model': ...} 或直接是模型
        if isinstance(model, dict):
            if 'model' in model:
                model = model['model']
                print("Extracted 'model' key from checkpoint")
            elif 'model_state_dict' in model:
                print("Model format not recognized. Please ensure you have a standard YOLO .pt file.")
                return False

        # 转换为 FP32 全精度 (模型可能是 FP16)
        model = model.float()
        print(f"Model converted to FP32")

        # 设置为评估模式
        model.eval()

        # 创建假输入
        dummy_input = torch.randn(1, 3, img_size, img_size)

        print(f"Converting to ONNX...")
        print(f"  Input shape: {dummy_input.shape}")
        print(f"  Output path: {output_path}")

        # 导出为 ONNX
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=11,
            do_constant_folding=True,
            input_names=['images'],
            output_names=['output'],
            dynamic_axes={
                'images': {0: 'batch_size', 2: 'height', 3: 'width'},
                'output': {0: 'batch_size'}
            }
        )

        print("Conversion successful!")
        return True

    except Exception as e:
        print(f"Error during conversion: {e}")
        import traceback
        traceback.print_exc()
        return False

def verify_onnx_model(model_path):
    """验证 ONNX 模型"""
    try:
        import onnx
        model = onnx.load(model_path)
        onnx.checker.check_model(model)
        print(f"ONNX model verified successfully: {model_path}")
        return True
    except Exception as e:
        print(f"ONNX verification failed: {e}")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert YOLO model to ONNX")
    parser.add_argument('--input', '-i', required=True, help='Input .pt model path')
    parser.add_argument('--output', '-o', required=True, help='Output .onnx model path')
    parser.add_argument('--img-size', '-s', type=int, default=640, help='Input image size')
    parser.add_argument('--verify', '-v', action='store_true', help='Verify ONNX model after conversion')

    args = parser.parse_args()

    success = convert_yolo_to_onnx(args.input, args.output, args.img_size)

    if success and args.verify:
        verify_onnx_model(args.output)

    sys.exit(0 if success else 1)
