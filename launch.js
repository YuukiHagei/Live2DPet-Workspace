#!/usr/bin/env node
// Launch script: ensures ELECTRON_RUN_AS_NODE is removed before starting Electron.
// VSCode's integrated terminal sets this env var, which forces electron.exe
// into plain Node.js mode, breaking require('electron').
//
// 为什么这里要打印诊断信息：
//   Electron 是 GUI 程序，主进程的 console.log 在 Windows 控制台里通常看不到，
//   而「已有实例在运行」时 main.js 会直接 app.quit()（退出码 0、零输出），
//   表现就是命令行一闪回到提示符、看起来像「没反应」。这里把这种情况翻译成人话。
const { spawn } = require('child_process');
const electronPath = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const FAST_EXIT_SECONDS = 5;

/**
 * 根据退出码与耗时给出可读的原因和建议。
 * @param {number|null} code 退出码（null = 被信号杀掉）
 * @param {string|null} signal 信号名
 * @param {number} seconds 运行了多久
 * @returns {string} 要打印的多行文本（为空字符串表示无需额外说明）
 */
function explainExit(code, signal, seconds) {
    if (code === null) {
        return `[launch] Electron 被信号终止（${signal}），运行了 ${seconds.toFixed(1)}s。`;
    }
    if (code === 0 && seconds < FAST_EXIT_SECONDS) {
        return [
            '',
            `[launch] Electron 启动后 ${seconds.toFixed(1)}s 就退出了（退出码 0，属于正常退出）。`,
            '        最常见原因：已经有一个 Live2DPet 在运行。主进程有单实例锁，',
            '        第二个进程会立刻退出，所以看起来像「没反应」。',
            '',
            '        处理：右键任务栏托盘里的 Live2DPet 图标 → 退出（或关掉旧的窗口后确认进程已结束）。',
            '        确认没有残留进程：',
            '          tasklist | findstr /I "Live2DPet electron"',
            '          taskkill /IM "Live2DPet Workspace.exe" /F',
            '',
            '        确认后重新运行：node launch.js',
            ''
        ].join('\n');
    }
    if (code !== 0 && seconds < 10) {
        return [
            '',
            `[launch] Electron 启动失败（退出码 ${code}，运行了 ${seconds.toFixed(1)}s）。`,
            '        看详细日志：node launch.js --enable-logging',
            ''
        ].join('\n');
    }
    return '';
}

function main() {
    console.log(`[launch] Electron: ${electronPath}`);
    console.log(`[launch] 工作目录: ${process.cwd()}`);

    const startedAt = Date.now();
    const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: process.env
    });

    child.on('error', (err) => {
        console.error(`[launch] 无法启动 Electron：${err.message}`);
        console.error('        可能原因：node_modules/electron 安装不完整（试 npm install），或被安全软件拦截。');
        process.exit(1);
    });

    child.on('close', (code, signal) => {
        const seconds = (Date.now() - startedAt) / 1000;
        const msg = explainExit(code, signal, seconds);
        if (msg) console.error(msg);
        process.exit(code === null ? 1 : code);
    });

    ['SIGINT', 'SIGTERM'].forEach(sig => {
        process.on(sig, () => { if (!child.killed) child.kill(sig); });
    });
}

if (require.main === module) {
    main();
}

module.exports = { explainExit };
