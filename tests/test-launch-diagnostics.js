/**
 * Unit tests for launch.js 的退出诊断
 * Run with: node --test tests/test-launch-diagnostics.js
 *
 * 背景：Electron 是 GUI 程序，主进程日志在 Windows 控制台往往不可见；
 * 单实例锁命中时 main.js 直接 app.quit()（退出码 0、零输出），
 * 用户看到的就是「node launch.js 没反应」。这里保证启动器会自己解释原因。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { explainExit } = require('../launch.js');

describe('explainExit', () => {
    it('explains the fast clean exit as a single-instance lock', () => {
        const msg = explainExit(0, null, 0.4);
        assert.match(msg, /1 个实例|已经有一个 Live2DPet 在运行|单实例锁/);
        assert.match(msg, /node launch\.js/);
        assert.match(msg, /taskkill|托盘/);
    });

    it('stays quiet for a normal long session', () => {
        assert.strictEqual(explainExit(0, null, 300), '');
        assert.strictEqual(explainExit(0, null, 12), '');
    });

    it('reports a non-zero exit with the code and a logging hint', () => {
        const msg = explainExit(3, null, 1.2);
        assert.match(msg, /启动失败/);
        assert.match(msg, /退出码 3/);
        assert.match(msg, /--enable-logging/);
    });

    it('reports the sandbox-style crash code instead of hiding it', () => {
        const msg = explainExit(-2147483645, null, 0.06);
        assert.match(msg, /启动失败/);
        assert.match(msg, /-2147483645/);
    });

    it('reports signal termination', () => {
        const msg = explainExit(null, 'SIGTERM', 8);
        assert.match(msg, /被信号终止/);
        assert.match(msg, /SIGTERM/);
    });

    it('does not treat a long clean session as a failure', () => {
        assert.match(explainExit(0, null, 4.999), /单实例锁|已经有一个 Live2DPet 在运行/, '阈值内仍算快速退出');
        assert.strictEqual(explainExit(0, null, 5.001), '', '超过阈值就不该报警');
    });
});
