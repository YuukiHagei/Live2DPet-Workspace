/**
 * TTS IPC — TTS synthesis, VOICEVOX setup, VVM management.
 * Extracted from main.js lines 939-1153.
 */

/**
 * Split Japanese text at sentence-ending punctuation for chunked TTS.
 * Keeps consecutive punctuation + decorative chars (……♡～) as a unit.
 */
function splitForTTS(text, maxLen = 80) {
    if (!text || text.length <= maxLen) return [text];
    const parts = [];
    let last = 0;
    const re = /[。！？]+[…♡♪～☆]*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        parts.push(text.slice(last, m.index + m[0].length));
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));

    // Merge short segments so each chunk is reasonably sized
    const chunks = [];
    let buf = '';
    for (const seg of parts) {
        if (buf.length + seg.length > maxLen && buf.length > 0) {
            chunks.push(buf);
            buf = '';
        }
        buf += seg;
    }
    if (buf) chunks.push(buf);
    return chunks;
}

/**
 * Concatenate multiple WAV buffers (same format) into one.
 * Strips headers, merges PCM data, writes new header.
 */
function concatWavBuffers(buffers) {
    if (buffers.length === 0) return null;
    if (buffers.length === 1) return buffers[0];

    // Read format from first buffer's header (bytes 0-43)
    const hdr = buffers[0];
    const numChannels = hdr.readUInt16LE(22);
    const sampleRate = hdr.readUInt32LE(24);
    const bitsPerSample = hdr.readUInt16LE(34);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;

    // Extract PCM data (skip 44-byte header) from each buffer
    const pcmParts = buffers.map(b => b.slice(44));
    const totalPcmLen = pcmParts.reduce((sum, p) => sum + p.length, 0);

    // Build new WAV: 44-byte header + combined PCM
    const out = Buffer.alloc(44 + totalPcmLen);
    out.write('RIFF', 0);
    out.writeUInt32LE(36 + totalPcmLen, 4);
    out.write('WAVE', 8);
    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16);          // fmt chunk size
    out.writeUInt16LE(1, 20);           // PCM format
    out.writeUInt16LE(numChannels, 22);
    out.writeUInt32LE(sampleRate, 24);
    out.writeUInt32LE(byteRate, 28);
    out.writeUInt16LE(blockAlign, 32);
    out.writeUInt16LE(bitsPerSample, 34);
    out.write('data', 36);
    out.writeUInt32LE(totalPcmLen, 40);

    let offset = 44;
    for (const pcm of pcmParts) {
        pcm.copy(out, offset);
        offset += pcm.length;
    }
    return out;
}

function registerTTSIPC(ctx, ipcMain, deps) {
    // deps: { configManager, fs, path, app, mt }
    const { configManager, fs, path, app, mt } = deps;

    ipcMain.handle('tts-synthesize', async (event, text) => {
        try {
            if (!ctx.ttsService || !ctx.ttsService.isAvailable()) {
                return { success: false, error: 'TTS not available' };
            }
            let jaText = text;
            if (ctx.translationService && ctx.translationService.isConfigured()) {
                jaText = await ctx.translationService.translate(text);
            }
            console.log(`[TTS] CN: ${text}`);
            console.log(`[TTS] JA: ${jaText}`);

            const chunks = splitForTTS(jaText);
            const rss0 = Math.round(process.memoryUsage().rss / 1024 / 1024);

            const wavBufs = [];
            for (const chunk of chunks) {
                const buf = ctx.ttsService.synthesize(chunk);
                if (buf) wavBufs.push(buf);
            }
            if (wavBufs.length === 0) return { success: false, error: 'synthesis failed' };

            const combined = concatWavBuffers(wavBufs);
            const rss1 = Math.round(process.memoryUsage().rss / 1024 / 1024);
            console.log(`[TTS] ${chunks.length} chunk(s), RSS: ${rss0}→${rss1} MB`);

            return { success: true, wav: combined.toString('base64'), jaText };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('tts-get-status', async () => {
        return {
            initialized: ctx.ttsService?.initialized || false,
            available: ctx.ttsService?.isAvailable() || false,
            degraded: ctx.ttsService?.degraded || false,
            degradedAt: ctx.ttsService?.degradedAt || 0,
            retryInterval: ctx.ttsService?.retryInterval || 60000,
            styleId: ctx.ttsService?.styleId || 0,
            gpuMode: ctx.ttsService?.isGpu || false,
            translationConfigured: ctx.translationService?.isConfigured() || false
        };
    });

    ipcMain.handle('tts-restart', async () => {
        try {
            if (ctx.ttsService) ctx.ttsService.destroy();
            const voicevoxDir = ctx.pathUtils.getVoicevoxPath();
            if (!voicevoxDir || !fs.existsSync(voicevoxDir)) {
                return { success: false, error: 'voicevox_core not found' };
            }
            const config = await configManager.loadConfigFile();
            const vvmFiles = config.tts?.vvmFiles || ['0.vvm', '8.vvm'];
            const gpuMode = config.tts?.gpuMode || false;
            const ok = ctx.ttsService.init(voicevoxDir, vvmFiles, { gpuMode });
            if (ok && config.tts) ctx.ttsService.setConfig(config.tts);
            return { success: ok, error: ok ? undefined : 'init failed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('app-relaunch', async () => {
        if (app.isPackaged) {
            const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
            app.relaunch({ execPath: exePath, args: [] });
        } else {
            app.relaunch();
        }
        app.exit(0);
    });

    ipcMain.handle('tts-get-metas', async () => {
        if (!ctx.ttsService) return [];
        return ctx.ttsService.getMetas();
    });

    ipcMain.handle('tts-get-available-vvms', async () => {
        if (!ctx.ttsService || !ctx.pathUtils) return [];
        return ctx.ttsService.getAvailableVvms(ctx.pathUtils.getVoicevoxPath());
    });

    ipcMain.handle('download-vvm', async (event, filename) => {
        if (!ctx.pathUtils) return { success: false, error: 'not ready' };
        if (!filename || !/^[\w.-]+\.vvm$/.test(filename)) return { success: false, error: 'invalid filename' };
        const modelsDir = path.join(ctx.pathUtils.getVoicevoxPath(), 'models');
        if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
        const target = path.join(modelsDir, filename);
        if (fs.existsSync(target)) return { success: true, message: 'already exists' };
        try {
            const { execFile } = require('child_process');
            const url = `https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.3/${filename}`;
            await new Promise((resolve, reject) => {
                execFile('curl', ['-L', '-o', target, url],
                    { timeout: 120000 }, (err, stdout, stderr) => {
                        if (err) reject(new Error(stderr || err.message));
                        else resolve(stdout);
                    });
            });
            console.log(`[VVM] Downloaded: ${filename}`);
            return { success: true };
        } catch (e) {
            console.error(`[VVM] Download failed: ${e.message}`);
            if (fs.existsSync(target)) fs.unlinkSync(target);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('setup-voicevox', async (event) => {
        if (!ctx.pathUtils) return { success: false, error: 'not ready' };
        const { execFile } = require('child_process');
        const baseDir = ctx.pathUtils.getVoicevoxPath();
        const send = (msg) => {
            console.log(`[VOICEVOX Setup] ${msg}`);
            try { event.sender.send('voicevox-setup-progress', msg); } catch {}
        };

        const run = (cmd, args, opts) => new Promise((resolve, reject) => {
            execFile(cmd, args, { timeout: 300000, ...opts }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout);
            });
        });

        try {
            const modelsDir = path.join(baseDir, 'models');
            const cApiDir = path.join(baseDir, 'c_api');
            fs.mkdirSync(modelsDir, { recursive: true });
            fs.mkdirSync(cApiDir, { recursive: true });

            // 1. Core DLL
            const coreDll = path.join(cApiDir, 'voicevox_core-windows-x64-0.16.3', 'lib', 'voicevox_core.dll');
            if (!fs.existsSync(coreDll)) {
                send(mt('main.setupDlCore'));
                const coreZip = path.join(baseDir, 'voicevox_core-windows-x64-0.16.3.zip');
                await run('curl', ['-L', '-o', coreZip,
                    'https://github.com/VOICEVOX/voicevox_core/releases/download/0.16.3/voicevox_core-windows-x64-0.16.3.zip']);
                send(mt('main.setupExtractCore'));
                await run('powershell', ['-Command',
                    `Expand-Archive -Path "${coreZip}" -DestinationPath "${cApiDir}" -Force`]);
                fs.unlinkSync(coreZip);
            } else {
                send(mt('main.setupCoreExists'));
            }

            // 2. ONNX Runtime (CPU)
            const onnxDll = path.join(baseDir, 'voicevox_onnxruntime-win-x64-1.17.3', 'lib', 'voicevox_onnxruntime.dll');
            if (!fs.existsSync(onnxDll)) {
                send(mt('main.setupDlOnnx'));
                const onnxTgz = path.join(baseDir, 'voicevox_onnxruntime-win-x64-1.17.3.tgz');
                await run('curl', ['-L', '-o', onnxTgz,
                    'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-1.17.3.tgz']);
                send(mt('main.setupExtractOnnx'));
                await run('tar', ['xzf', onnxTgz, '-C', baseDir]);
                fs.unlinkSync(onnxTgz);
            } else {
                send(mt('main.setupOnnxExists'));
            }

            // 2b. ONNX Runtime (DirectML / GPU)
            const dmlDll = path.join(baseDir, 'voicevox_onnxruntime-win-x64-dml-1.17.3', 'lib', 'voicevox_onnxruntime.dll');
            if (!fs.existsSync(dmlDll)) {
                send(mt('main.setupDlDml'));
                const dmlTgz = path.join(baseDir, 'voicevox_onnxruntime-win-x64-dml-1.17.3.tgz');
                await run('curl', ['-L', '-o', dmlTgz,
                    'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-dml-1.17.3.tgz']);
                send(mt('main.setupExtractDml'));
                await run('tar', ['xzf', dmlTgz, '-C', baseDir]);
                fs.unlinkSync(dmlTgz);
            } else {
                send(mt('main.setupDmlExists'));
            }

            // 3. Open JTalk dictionary
            const dictDir = path.join(baseDir, 'open_jtalk_dic_utf_8-1.11');
            if (!fs.existsSync(dictDir)) {
                send(mt('main.setupDlDict'));
                const dictTgz = path.join(baseDir, 'dict.tar.gz');
                await run('curl', ['-L', '-o', dictTgz,
                    'https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download'],
                    { timeout: 300000 });
                send(mt('main.setupExtractDict'));
                await run('tar', ['xzf', dictTgz, '-C', baseDir]);
                fs.unlinkSync(dictTgz);
            } else {
                send(mt('main.setupDictExists'));
            }

            // 4. Default VVM (0.vvm)
            const vvm0 = path.join(modelsDir, '0.vvm');
            if (!fs.existsSync(vvm0)) {
                send(mt('main.setupDlVvm'));
                await run('curl', ['-L', '-o', vvm0,
                    'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.3/0.vvm']);
            } else {
                send(mt('main.setupVvmExists'));
            }

            send(mt('main.setupDone'));
            return { success: true, path: baseDir };
        } catch (e) {
            send(mt('main.setupFail') + e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('tts-set-config', async (event, config) => {
        if (ctx.ttsService && config) {
            ctx.ttsService.setConfig(config);
            await configManager.saveConfigFile({
                tts: {
                    styleId: ctx.ttsService.styleId,
                    speedScale: ctx.ttsService.speedScale,
                    pitchScale: ctx.ttsService.pitchScale,
                    volumeScale: ctx.ttsService.volumeScale
                }
            });
        }
        return { success: true };
    });
}

module.exports = { registerTTSIPC };
