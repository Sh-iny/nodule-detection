@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo  Lung Nodule Detection Server
echo ========================================
echo.

echo Starting backend server...
echo.

cd /d "%~dp0"

:: Use conda gra environment directly
"D:\Anaconda\envs\gra\python.exe" backend\main.py

echo.
echo Server stopped.
pause
