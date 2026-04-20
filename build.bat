@echo off
chcp 65001 >nul 2>&1
echo ====================================
echo Lung Nodule Detection - Build Script
echo ====================================
echo.

:: Use D:\python as the Python environment
set PYTHON_PATH=D:\python\python.exe

:: Check Python
"%PYTHON_PATH%" --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found at %PYTHON_PATH%
    pause
    exit /b 1
)

:: Install dependencies if needed
echo [Step 1] Checking dependencies...
"%PYTHON_PATH%" -m pip install fastapi uvicorn starlette pydantic onnxruntime opencv-python pyinstaller "setuptools<81" --quiet 2>nul

echo.
echo [Step 2] Building...
cd /d "%~dp0"

:: Clean old builds
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"

:: Build
"%PYTHON_PATH%" -m PyInstaller build\lung_nodule_detector.spec --clean --noconfirm

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Check errors above.
    pause
    exit /b 1
)

:: Create data folder
if not exist "dist\LungNoduleDetector\data" mkdir "dist\LungNoduleDetector\data"

echo.
echo ====================================
echo Build Complete!
echo Output: dist\LungNoduleDetector
echo.
echo Run: dist\LungNoduleDetector\LungNoduleDetector.exe
echo.
pause
