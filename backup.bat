@echo off
chcp 65001 >nul
setlocal

set "SRC=%APPDATA%\live2dpet"
set "DST=G:\Live2DPet-Backup"

:: 取日期
for /f "tokens=1-3 delims=/- " %%a in ('date /t') do set TODAY=%%a%%c%%b
set "DST=%DST%-%TODAY%"

echo 备份源: %SRC%
echo 备份到: %DST%
echo.

if not exist "%SRC%" (
    echo [错误] 找不到 %SRC%，请先启动一次 Live2DPet
    pause
    exit /b 1
)

mkdir "%DST%" 2>nul
xcopy /E /I /Y "%SRC%\config.json" "%DST%\config.json" >nul
xcopy /E /I /Y "%SRC%\data"        "%DST%\data"        >nul
xcopy /E /I /Y "%SRC%\prompts"     "%DST%\prompts"     >nul
xcopy /E /I /Y "%SRC%\models"      "%DST%\models"      >nul

echo.
echo [完成] 备份到 %DST%
echo.
pause