@echo off
chcp 65001 >nul
setlocal

set "BACKUP_DIR=G:\Live2DPet-Backup"
set "DST=%APPDATA%\live2dpet"

:: 支持拖拽参数：restore.bat "G:\Live2DPet-Backup-20260926"
if not "%~1"=="" set "BACKUP_DIR=%~1"

echo 从: %BACKUP_DIR%
echo 到: %DST%
echo.

if not exist "%BACKUP_DIR%" (
    echo [错误] 找不到备份目录
    pause
    exit /b 1
)

if not exist "%DST%" (
    echo [提示] %DST% 不存在，请先启动一次 Live2DPet 再运行本脚本
    pause
    exit /b 1
)

xcopy /E /I /Y "%BACKUP_DIR%\config.json" "%DST%\config.json" >nul
xcopy /E /I /Y "%BACKUP_DIR%\data"        "%DST%\data"        >nul
xcopy /E /I /Y "%BACKUP_DIR%\prompts"     "%DST%\prompts"     >nul
xcopy /E /I /Y "%BACKUP_DIR%\models"      "%DST%\models"      >nul

echo.
echo [完成] 恢复自 %BACKUP_DIR%
echo.
pause