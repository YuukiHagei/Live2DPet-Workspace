/**
 * StartupSync — 启动时静默同步
 * 逻辑：分析冲突，按安全顺序执行 push / pull。有冲突时不弹窗，只记录。
 */
function createStartupSync(deps) {
    // deps: { getActiveCloudSync, configManager }

    async function run() {
        try {
            // 1. 读配置，检查是否启用云同步
            const cfg = await deps.configManager.loadConfigFile();
            const cloud = cfg.cloud || {};
            if (!cloud.enabled) {
                console.log('[StartupSync] cloud sync disabled, skip');
                return { skipped: true, reason: 'disabled' };
            }

            const active = await deps.getActiveCloudSync();
            if (!active) {
                console.log('[StartupSync] no active sync instance');
                return { skipped: true, reason: 'no-instance' };
            }

            // 2. 分析冲突
            console.log('[StartupSync] analyzing cloud state...');
            const analysis = await active.analyzeConflicts();
            const { conflicts, safe } = analysis;

            if (conflicts.length > 0) {
                console.warn('[StartupSync] conflicts detected, skip auto-sync:', 
                    conflicts.map(c => c.filename).join(', '));
                // 记录未解决的冲突，UI 后续可显示提示
                if (active._unresolvedConflicts === undefined) {
                    // 有 setter 的实例才设置
                }
                return { 
                    skipped: true, 
                    reason: 'conflicts', 
                    conflicts: conflicts.map(c => c.filename) 
                };
            }

            if (safe.length === 0) {
                console.log('[StartupSync] no changes, nothing to sync');
                return { skipped: true, reason: 'no-changes' };
            }

            // 3. 执行同步（resolutions 为空，因为无冲突）
            console.log(`[StartupSync] syncing ${safe.length} file(s)...`);
            const result = await active.syncWithResolutions({});

            if (result.ok) {
                console.log(`[StartupSync] done. pushed: ${result.pushed.length}, pulled: ${result.pulled.length}`);
            } else {
                console.warn('[StartupSync] partial failure:', result.failed);
            }

            return {
                ok: result.ok,
                pushed: result.pushed,
                pulled: result.pulled,
                failed: result.failed
            };
        } catch (err) {
            console.warn('[StartupSync] error:', err.message);
            return { skipped: true, reason: 'error', error: err.message };
        }
    }

    return { run };
}

module.exports = { createStartupSync };