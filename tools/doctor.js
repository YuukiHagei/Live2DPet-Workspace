#!/usr/bin/env node
/**
 * doctor.js — 启动问题自检
 *
 * 用途：`node launch.js` 打不开、或 Electron 闪退（例如退出码 0x80000003）时，
 * 一条命令收齐所有关键信息，并把结论直接说出来，不用来回复猜。
 *
 * 用法：
 *   node tools/doctor.js            # 全部检查（会在超时后关掉测试窗口）
 *   node tools/doctor.js --quick    # 只查环境与 electron 版本，不启动应用
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUICK = process.argv.includes('--quick');
const VERSION_TIMEOUT = 20000;
const APP_TIMEOUT = 25000;

const results = [];
function record(label, ok, detail) {
    results.push({ label, ok, detail });
    const mark = ok === null ? '··' : (ok ? 'OK ' : '!! ');
    console.log(`${mark} ${label}${detail ? '  —  ' + detail : ''}`);
}

function hex32(code) {
    if (typeof code !== 'number') return String(code);
    return `${code} (0x${(code >>> 0).toString(16).toUpperCase()})`;
}

function run(bin, args, timeout, cwd) {
    const started = Date.now();
    // 复制一份干净的环境：ELECTRON_RUN_AS_NODE 会让 electron.exe 变成纯 Node 进程
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(bin, args, {
        cwd: cwd || ROOT,
        timeout,
        encoding: 'utf8',
        windowsHide: true,
        env
    });
    return {
        code: r.status,
        signal: r.signal,
        stdout: (r.stdout || '').trim(),
        stderr: (r.stderr || '').trim(),
        ms: Date.now() - started,
        error: r.error ? r.error.message : null
    };
}

function findElectron() {
    try {
        const p = require('electron');
        return typeof p === 'string' ? p : null;
    } catch (err) {
        return { error: err.message };
    }
}

function printRecentWerEvents() {
    const ps = spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
        "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddHours(-6)} -ErrorAction SilentlyContinue | " +
        "Where-Object { $_.Message -match 'electron' } | Select-Object -First 3 | " +
        "ForEach-Object { $_.TimeCreated.ToString('HH:mm:ss') + '  ' + (($_.Message -split \"`n\")[0]) }"
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const out = (ps.stdout || '').trim();
    if (out) {
        console.log('\n--- Windows 事件日志里的 electron 崩溃记录 ---');
        console.log(out);
    }
}

console.log('==================================================');
console.log(' Live2DPet 启动自检');
console.log('==================================================');
console.log(`Node        : ${process.version}`);
console.log(`平台        : ${process.platform} ${os.release()}`);
console.log(`项目目录    : ${ROOT}`);
console.log('');
console.log('--- 1. 环境变量 ---');

const risky = {
    ELECTRON_RUN_AS_NODE: '会让 electron.exe 变成纯 Node 进程（launch.js 会临时清掉它）',
    NODE_OPTIONS: '会被 Electron 继承，某些参数会导致启动直接失败',
    ELECTRON_NO_ATTACH_CONSOLE: '会阻止 Electron 连接控制台输出',
    ELECTRON_ENABLE_LOGGING: '影响日志输出位置（不是错误，仅提示）'
};
let envBad = false;
for (const [key, why] of Object.entries(risky)) {
    const value = process.env[key];
    if (value !== undefined && key !== 'ELECTRON_ENABLE_LOGGING') {
        envBad = true;
        record(`${key}=${value}`, false, why);
    } else if (value !== undefined) {
        record(`${key}=${value}`, null, why);
    }
}
if (!envBad) record('没有会干扰启动的环境变量', true);

console.log('\n--- 2. electron 安装 ---');
const electronPath = findElectron();
if (!electronPath || typeof electronPath !== 'string') {
    record('require("electron") 失败', false, typeof electronPath === 'object' ? electronPath.error : '未安装');
    console.log('\n结论：先修依赖 —— npm install');
    process.exit(1);
}
const exists = fs.existsSync(electronPath);
record('electron 可执行文件存在', exists, electronPath);
if (!exists) {
    console.log('\n结论：node_modules/electron 不完整 —— 删掉 node_modules/electron 后重新 npm install');
    process.exit(1);
}
record('electron 可执行文件大小', true, `${fs.statSync(electronPath).size} 字节`);

console.log('\n--- 2.5 权限与安全软件（Chromium 沙箱常见干扰源）---');
const who = spawnSync('whoami', ['/groups'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
const elevated = /S-1-16-12288/.test(who.stdout || '');
record(elevated ? '当前进程是管理员权限' : '当前进程是普通用户权限', elevated ? null : null,
    elevated ? 'Chromium 在管理员权限下启动沙箱更容易失败，可换普通 cmd 再试' : '');

const avQuery = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | ForEach-Object { $_.displayName }"
], { encoding: 'utf8', timeout: 15000, windowsHide: true });
const avList = (avQuery.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (avQuery.error) {
    record('读取安全软件列表失败', null, avQuery.error.message);
} else {
    record(avList.length ? '检测到安全软件' : '未检测到已注册的安全软件', null, avList.join('、') || '');
}
if (avList.length) {
    console.log('    若 Electron 起不来，先把 electron.exe 或整个项目目录加白 / 临时关闭防护再试一次。');
}

console.log('\n--- 3. electron --version（只验证二进制本身能不能跑起来）---');
const ver = run(electronPath, ['--version'], VERSION_TIMEOUT);
if (ver.error) {
    record('启动 electron.exe 失败', false, ver.error);
} else if (ver.code === 0) {
    record('electron 能启动', true, (ver.stdout || ver.stderr || '（无输出，但退出码 0）').split('\n')[0]);
} else {
    record('electron 无法启动', false, `退出码 ${hex32(ver.code)}，耗时 ${ver.ms}ms`);
    if (ver.stderr) console.log('  stderr: ' + ver.stderr.split('\n').slice(0, 5).join(' | '));
}

const electronBroken = ver.code !== 0;

if (!QUICK) {
    console.log('\n--- 4. 最小 Electron 应用（排除本项目的代码）---');
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-probe-'));
    fs.writeFileSync(path.join(probeDir, 'package.json'), JSON.stringify({ name: 'probe', main: 'main.js' }));
    fs.writeFileSync(path.join(probeDir, 'main.js'), [
        "const { app } = require('electron');",
        "app.whenReady().then(() => {",
        "  console.log('[probe] ready, electron ' + process.versions.electron);",
        "  setTimeout(() => app.quit(), 400);",
        "});"
    ].join('\n'));
    const probe = run(electronPath, [probeDir], VERSION_TIMEOUT);
    const probeOk = probe.code === 0;
    record('最小 Electron 应用能启动', probeOk,
        probeOk ? '正常' : `退出码 ${hex32(probe.code)}，耗时 ${probe.ms}ms`);
    if (!probeOk && probe.stderr) {
        console.log('  stderr: ' + probe.stderr.split('\n').slice(0, 6).join(' | '));
    }
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}

    console.log('\n--- 5. 本项目启动（独立数据目录，不碰真实数据）---');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-doctor-data-'));
    const appRun = run(electronPath, ['.', `--user-data-dir=${dataDir}`], APP_TIMEOUT);
    // 正常运行的标志：跑满超时（说明窗口一直开着）或者正常退出（0）
    const stayedAlive = appRun.signal === 'SIGTERM' || appRun.ms >= APP_TIMEOUT - 1500;
    const appOk = appRun.code === 0 || stayedAlive;
    record('本项目能启动', appOk,
        stayedAlive ? `持续运行 ${Math.round(appRun.ms / 1000)}s（超时后已关闭）` : `退出码 ${hex32(appRun.code)}，耗时 ${appRun.ms}ms`);
    const appLog = [appRun.stdout, appRun.stderr].filter(Boolean).join('\n').trim();
    if (appLog) {
        console.log('  --- 应用输出（前 12 行）---');
        console.log(appLog.split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'));
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}

    console.log('\n--- 6. 关掉沙箱对照（--no-sandbox + --enable-logging）---');
    const noSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-doctor-nosandbox-'));
    const noSandbox = run(electronPath, [
        '.', '--no-sandbox', '--enable-logging', `--user-data-dir=${noSandboxDir}`
    ], APP_TIMEOUT);
    const noSandboxAlive = noSandbox.signal === 'SIGTERM' || noSandbox.ms >= APP_TIMEOUT - 1500;
    record('--no-sandbox 下能启动', noSandbox.code === 0 || noSandboxAlive,
        noSandboxAlive
            ? `持续运行 ${Math.round(noSandbox.ms / 1000)}s（超时后已关闭）`
            : `退出码 ${hex32(noSandbox.code)}，耗时 ${noSandbox.ms}ms`);
    const noSandboxLog = [noSandbox.stdout, noSandbox.stderr].filter(Boolean).join('\n').trim();
    if (noSandboxLog) {
        console.log('  --- 输出（前 30 行，含 Chromium 自己的报错）---');
        console.log(noSandboxLog.split('\n').slice(0, 30).map((l) => '  ' + l).join('\n'));
    } else {
        console.log('  （没有任何输出：说明在加载应用代码之前就退出了）');
    }
    try { fs.rmSync(noSandboxDir, { recursive: true, force: true }); } catch {}

    console.log('\n--- 7. Windows 漏洞防护（「强制 ASLR」是 Chromium 秒崩 0x80000003 的常见原因）---');
    const mit = spawnSync('powershell.exe', [
        '-NoProfile', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
        '$sys = Get-ProcessMitigation -System; ' +
        "'System.ForceRelocateImages=' + $sys.Aslr.ForceRelocateImages; " +
        "'System.BottomUp=' + $sys.Aslr.BottomUp; " +
        '$app = Get-ProcessMitigation -Name electron.exe -ErrorAction SilentlyContinue; ' +
        "if ($app) { 'App.ForceRelocateImages=' + $app.Aslr.ForceRelocateImages; 'App.BottomUp=' + $app.Aslr.BottomUp } else { 'App=none' }"
    ], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const mitText = (mit.stdout || '').trim();
    if (mit.error) {
        record('读取进程缓解策略失败', null, mit.error.message);
    } else if (!mitText) {
        record('读取进程缓解策略', null, 'PowerShell 无输出（可能需要管理员权限）');
    } else {
        const kv = {};
        for (const line of mitText.split(/\r?\n/)) {
            const m = /^([\w.]+)=(.*)$/.exec(line.trim());
            if (m) kv[m[1]] = m[2].trim();
        }
        const sysForce = kv['System.ForceRelocateImages'];
        const sysBottom = kv['System.BottomUp'];
        const appForce = kv['App.ForceRelocateImages'];
        const hasOn = (v) => !!v && !/^(NOTSET|OFF|FALSE|0)$/i.test(v);
        console.log(`  系统 强制 ASLR (ForceRelocateImages) : ${sysForce || '未知'}`);
        console.log(`  系统 自底向上 ASLR (BottomUp)      : ${sysBottom || '未知'}`);
        console.log(`  electron.exe 专用策略             : ${appForce === undefined ? '未配置' : appForce}`);
        if (hasOn(sysForce) || hasOn(appForce)) {
            record('强制 ASLR 已开启（会打断 Chromium 启动）', false,
                '关掉：Windows 安全中心 → 应用和浏览器控制 → 漏洞防护 → 程序设置 → 添加 electron.exe → 取消「强制随机化映像」');
        } else {
            record('强制 ASLR 未开启（不是崩溃原因）', true, `System=${sysForce || 'NOTSET'}`);
        }
    }

    console.log('\n--- 结论 ---');
    if (electronBroken && !probeOk) {
        console.log('Electron 二进制本身起不来（与项目代码无关）。');
        if (noSandbox.code === 0 || noSandboxAlive) {
            console.log('→ 关闭 Chromium 沙箱后可以启动：问题在系统的「沙箱/ASLR/安全软件」这一层，不是项目代码。');
            console.log('  优先按第 7 节处理「强制 ASLR」；其次把 electron.exe 加白。');
        } else if (noSandboxLog) {
            console.log('→ 关沙箱后仍然起不来，但这次有输出：把第 6 节的输出贴出来即可定位。');
        } else {
            console.log('→ 关沙箱后依旧无输出退出：先按第 7 节处理 ASLR，再试安全软件加白。');
        }
        console.log('  参考顺序：1) 关「强制 ASLR」 2) 安全软件加白 3) 换普通/管理员权限 4) 重装 electron');
        printRecentWerEvents();
    } else if (!electronBroken && probeOk && !appOk) {
        console.log('Electron 正常、最小应用正常，但本项目启动失败 —— 问题在本项目代码。');
        console.log('把上面「应用输出」贴出来即可定位。');
    } else if (appOk) {
        console.log('本项目可以正常启动。如果命令行里看到窗口没出现，检查是否已有实例占用了单实例锁。');
    }
} else {
    console.log('\n（--quick 模式：跳过启动测试）');
}

printRecentWerEvents();

const failed = results.filter((r) => r.ok === false);
console.log('');
console.log(failed.length === 0 ? '全部检查通过。' : `有 ${failed.length} 项检查失败，见上面标记 !! 的行。`);
process.exit(0);
