/**
 * Settings UI Controller
 * Handles all tab interactions, model import, expression management, etc.
 */
let petSystem = null;
let currentModelConfig = {};
let suggestedMapping = null;
let scannedParamIds = [];
let scannedMotions = {};  // {group: [{file}]} from scan-model-info

// ========== i18n System ==========
let currentLang = 'en';

function t(key) {
    return (window.I18N && window.I18N[currentLang] && window.I18N[currentLang][key])
        || (window.I18N && window.I18N['en'] && window.I18N['en'][key])
        || key;
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPh);
    });
}

function setLanguage(lang) {
    currentLang = lang;
    document.getElementById('lang-select').value = lang;
    applyI18n();
    if (window.electronAPI) window.electronAPI.saveConfig({ uiLanguage: lang });
    // Reload character card in new language (for built-in i18n cards)
    if (currentCharacterId) {
        loadCharacterPrompt(currentCharacterId);
        // Also refresh the character list labels (builtin tag is localized)
        loadCharacterList();
    }
    reloadPetPrompt();
}

document.getElementById('lang-select').addEventListener('change', (e) => {
    setLanguage(e.target.value);
});

document.addEventListener('DOMContentLoaded', async () => {
    petSystem = new DesktopPetSystem();
    await petSystem.init();

    // 显示陪伴天数
    if (window.electronAPI?.getCompanionStats) {
        const r = await window.electronAPI.getCompanionStats();
        if (r.success) {
            const h1 = document.querySelector('h1');
            if (h1) {
                const days = document.createElement('span');
                days.style.cssText = 'font-size:12px;color:#888;font-weight:normal;margin-left:8px;';
                days.textContent = `已陪伴 ${r.stats.totalDays} 天`;
                h1.appendChild(days);
            }
        }
    }

    // Wire emotion system callbacks to IPC
    petSystem.emotionSystem.onEmotionTriggered = (emotionName) => {
        console.log(`[SettingsUI] onEmotionTriggered → IPC triggerExpression("${emotionName}")`);
        if (window.electronAPI) window.electronAPI.triggerExpression(emotionName);
    };
    petSystem.emotionSystem.onEmotionReverted = () => {
        console.log('[SettingsUI] onEmotionReverted → IPC revertExpression');
        if (window.electronAPI) window.electronAPI.revertExpression();
    };
    petSystem.emotionSystem.onMotionTriggered = (group, index, emotionName) => {
        console.log(`[SettingsUI] onMotionTriggered → IPC triggerMotion("${group}", ${index}, "${emotionName}")`);
        if (window.electronAPI) window.electronAPI.triggerMotion(group, index);
    };

    // Load saved config
    const config = petSystem.aiClient.getConfig();
    document.getElementById('api-url').value = config.baseURL || '';
    document.getElementById('api-key').value = config.apiKey || '';
    document.getElementById('model-name').value = config.modelName || '';

    // Load full config
    if (window.electronAPI && window.electronAPI.loadConfig) {
        const fileConfig = await window.electronAPI.loadConfig();
        // Load UI language
        if (fileConfig.uiLanguage && window.I18N && window.I18N[fileConfig.uiLanguage]) {
            currentLang = fileConfig.uiLanguage;
            document.getElementById('lang-select').value = currentLang;
        }
        applyI18n();
        if (fileConfig.interval) {
            document.getElementById('interval').value = fileConfig.interval;
            petSystem.setInterval(parseInt(fileConfig.interval) * 1000);
        }
        if (fileConfig.chatGap != null) {
            document.getElementById('chat-gap').value = fileConfig.chatGap;
            petSystem.chatGapMs = parseInt(fileConfig.chatGap) * 1000;
        }
        // Load translation API config
        if (fileConfig.translation) {
            document.getElementById('tl-api-url').value = fileConfig.translation.baseURL || '';
            document.getElementById('tl-api-key').value = fileConfig.translation.apiKey || '';
            document.getElementById('tl-model-name').value = fileConfig.translation.modelName || '';
        }
        // Load model config
        currentModelConfig = fileConfig.model || { type: 'none' };
        loadModelUI();
        loadEmotionUI(fileConfig);
        // Load max_tokens multiplier
        loadTokenMultiplierUI(fileConfig.maxTokensMultiplier || 1.0);
        // Load enhance config
        loadEnhanceToggle(fileConfig.enhance || {});
        // Load startup config
        loadStartupConfig(fileConfig.startup || {});
        // Reload prompt with correct language (after language is set)
        await reloadPetPrompt();
    }
});

// ========== Tab Switching ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'prompt') loadCharacterList();
    });
});

// ========== Status Helper ==========
function showStatus(id, msg, type) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status ' + type;
    if (type !== 'info') setTimeout(() => { el.className = 'status'; }, 5000);
}

// ========== API Settings ==========
document.getElementById('btn-save-api').addEventListener('click', () => {
    const cfg = {
        baseURL: document.getElementById('api-url').value.trim(),
        apiKey: document.getElementById('api-key').value.trim(),
        modelName: document.getElementById('model-name').value.trim()
    };
    petSystem.aiClient.saveConfig(cfg);
    petSystem.systemPrompt = petSystem.promptBuilder.buildSystemPrompt();
    showStatus('api-status', t('status.saved'), 'success');
});

// ========== Translation API Settings ==========
document.getElementById('btn-save-tl').addEventListener('click', () => {
    const tl = {
        baseURL: document.getElementById('tl-api-url').value.trim(),
        apiKey: document.getElementById('tl-api-key').value.trim(),
        modelName: document.getElementById('tl-model-name').value.trim()
    };
    if (window.electronAPI) window.electronAPI.saveConfig({ translation: tl });
    showStatus('tl-status', t('status.saved'), 'success');
});

document.getElementById('btn-test-api').addEventListener('click', async () => {
    showStatus('api-status', t('status.testing'), 'info');
    const result = await petSystem.aiClient.testConnection();
    if (result.success) {
        showStatus('api-status', t('status.connected') + result.response, 'success');
    } else {
        showStatus('api-status', t('status.failed') + result.error, 'error');
    }
});

document.getElementById('btn-save-interval').addEventListener('click', () => {
    const seconds = parseInt(document.getElementById('interval').value);
    const chatGap = parseInt(document.getElementById('chat-gap').value);
    if (window.electronAPI) window.electronAPI.saveConfig({ interval: seconds, chatGap });
    petSystem.setInterval(seconds * 1000);
    petSystem.chatGapMs = chatGap * 1000;
});

// ========== Start/Stop ==========
document.getElementById('btn-start').addEventListener('click', () => petSystem.start());
document.getElementById('btn-stop').addEventListener('click', () => petSystem.stop());
document.getElementById('link-github').addEventListener('click', (e) => {
    e.preventDefault();
    if (window.electronAPI) window.electronAPI.openExternal('https://github.com/x380kkm/Live2DPet');
});

if (window.electronAPI) {
    window.electronAPI.onPetWindowClosed(() => {
        petSystem.isActive = false;
        petSystem.stopDetection();
    });
}

// ========== Hover State ==========
if (window.electronAPI && window.electronAPI.onPetHoverState) {
    window.electronAPI.onPetHoverState((isHovering) => {
        if (petSystem && petSystem.emotionSystem) {
            petSystem.emotionSystem.setHoverState(isHovering);
        }
    });
}

// ========== Model Tab ==========
const PARAM_LABELS = {
    angleX: 'param.angleX', angleY: 'param.angleY', angleZ: 'param.angleZ',
    bodyAngleX: 'param.bodyAngleX', eyeBallX: 'param.eyeBallX', eyeBallY: 'param.eyeBallY'
};

function loadModelUI() {
    const typeSelect = document.getElementById('model-type');
    typeSelect.value = currentModelConfig.type || 'none';
    updateModelCards();

    // Load existing values
    if (currentModelConfig.type === 'live2d') {
        document.getElementById('l2d-info').textContent =
            currentModelConfig.modelJsonFile ? `${t('status.modelInfo')}${currentModelConfig.modelJsonFile}` : '';
        document.getElementById('canvas-y-slider').value = currentModelConfig.canvasYRatio || 0.60;
        document.getElementById('canvas-y-val').textContent = (currentModelConfig.canvasYRatio || 0.60).toFixed(2);
        renderParamMapping();
    }
    if (currentModelConfig.type === 'image') {
        // Restore folder mode
        if (currentModelConfig.imageFolderPath) {
            document.getElementById('folder-info').textContent =
                `${t('status.folderInfo')}${currentModelConfig.imageFolderPath}`;
            document.getElementById('image-list-container').style.display = '';
            // Restore crop slider
            const cropScale = currentModelConfig.imageCropScale || 1.0;
            document.getElementById('image-crop-slider').value = cropScale;
            document.getElementById('image-crop-val').textContent = cropScale.toFixed(2);
            // Restore image list from saved config
            renderImageListFromConfig(currentModelConfig);
        }
    }
}

function updateModelCards() {
    const type = document.getElementById('model-type').value;
    document.getElementById('card-live2d').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-param-mapping').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-canvas-y').style.display = type === 'live2d' ? '' : 'none';
    document.getElementById('card-image').style.display = type === 'image' ? '' : 'none';
}

document.getElementById('model-type').addEventListener('change', () => {
    currentModelConfig.type = document.getElementById('model-type').value;
    updateModelCards();
});

// Canvas Y slider
document.getElementById('canvas-y-slider').addEventListener('input', (e) => {
    document.getElementById('canvas-y-val').textContent = parseFloat(e.target.value).toFixed(2);
    currentModelConfig.canvasYRatio = parseFloat(e.target.value);
});

// Image crop slider
document.getElementById('image-crop-slider').addEventListener('input', (e) => {
    document.getElementById('image-crop-val').textContent = parseFloat(e.target.value).toFixed(2);
    currentModelConfig.imageCropScale = parseFloat(e.target.value);
});

// Import Live2D
document.getElementById('btn-import-l2d').addEventListener('click', async () => {
    const result = await window.electronAPI.selectModelFolder();
    if (!result.success) {
        if (result.error !== 'cancelled') showStatus('model-status', result.error, 'error');
        return;
    }
    const folderPath = result.folderPath;
    const modelFile = result.modelFiles[0]; // Use first found

    // Scan model info
    showStatus('model-status', t('status.scanning'), 'info');
    const scanResult = await window.electronAPI.scanModelInfo(folderPath, modelFile);
    if (!scanResult.success) {
        showStatus('model-status', scanResult.error, 'error');
        return;
    }

    currentModelConfig.folderPath = folderPath;
    currentModelConfig.modelJsonFile = modelFile;
    currentModelConfig.type = 'live2d';
    document.getElementById('model-type').value = 'live2d';
    updateModelCards();

    // Store scan results
    scannedParamIds = scanResult.parameterIds || [];
    suggestedMapping = scanResult.suggestedMapping || {};

    // Show info
    const motionCount = Object.values(scanResult.motions || {}).reduce((sum, arr) => sum + arr.length, 0);
    const info = [`${t('status.modelInfo')}${scanResult.modelName}`,
        `${scannedParamIds.length} params`,
        `${scanResult.expressions.length} expr`,
        `${motionCount} motions`,
        `Moc: ${scanResult.validation.mocValid ? '✓' : '✗'}`,
        `Tex: ${scanResult.validation.texturesValid ? '✓' : '✗'}`
    ].join(' | ');
    document.getElementById('l2d-info').textContent = info;

    // Clear old expression/motion data for new model
    currentModelConfig.expressions = [];
    currentModelConfig.motionEmotions = [];
    currentModelConfig.expressionDurations = {};
    currentModelConfig.motionDurations = {};
    currentModelConfig.hasExpressions = false;

    // Auto-populate expressions
    if (scanResult.expressions.length > 0) {
        currentModelConfig.hasExpressions = true;
        currentModelConfig.expressions = scanResult.expressions.map(e => ({
            name: e.name, label: e.name, file: e.file
        }));
    }

    // Auto-populate motions
    scannedMotions = scanResult.motions || {};
    if (Object.keys(scannedMotions).length > 0) {
        const motionEmotions = [];
        for (const [group, entries] of Object.entries(scannedMotions)) {
            entries.forEach((entry, idx) => {
                const fileName = (entry.file || '').replace(/^.*[\\/]/, '').replace('.motion3.json', '');
                motionEmotions.push({
                    name: fileName || `${group}_${idx}`,
                    group, index: idx
                });
            });
        }
        currentModelConfig.motionEmotions = motionEmotions;
    }

    renderParamMapping();
    renderExpressionList(currentModelConfig);
    renderMotionList(currentModelConfig);

    // Copy to userData if checked
    if (document.getElementById('copy-to-userdata').checked) {
        showStatus('model-status', t('status.copyingModel'), 'info');
        const copyResult = await window.electronAPI.copyModelToUserdata(folderPath, scanResult.modelName);
        if (copyResult.success) {
            currentModelConfig.userDataModelPath = copyResult.userDataModelPath;
            showStatus('model-status', t('status.modelImported'), 'success');
        } else {
            showStatus('model-status', t('status.copyFailed') + copyResult.error, 'error');
        }
    } else {
        showStatus('model-status', t('status.modelSelected'), 'success');
    }
});

function renderParamMapping() {
    const container = document.getElementById('param-mapping-list');
    container.innerHTML = '';
    const pm = currentModelConfig.paramMapping || {};
    for (const [key, labelKey] of Object.entries(PARAM_LABELS)) {
        const mapped = pm[key];
        const suggested = suggestedMapping ? suggestedMapping[key] : null;
        // Sort: suggested first, then rest alphabetically
        const sorted = [...scannedParamIds].sort((a, b) => {
            if (a === suggested) return -1;
            if (b === suggested) return 1;
            return a.localeCompare(b);
        });
        const row = document.createElement('div');
        row.className = 'param-row';
        row.innerHTML = `
            <span class="param-label">${t(labelKey)}</span>
            <select class="param-select" data-key="${key}" style="flex:1;padding:4px;font-size:12px;border-radius:4px;">
                <option value="">${t('status.unmapped')}</option>
                ${sorted.map(id =>
                    `<option value="${id}" ${id === mapped ? 'selected' : ''}>${id}${id === suggested ? ' ★' : ''}</option>`
                ).join('')}
            </select>
        `;
        container.appendChild(row);
    }
    // Listen for manual changes
    container.querySelectorAll('.param-select').forEach(sel => {
        sel.addEventListener('change', () => {
            if (!currentModelConfig.paramMapping) currentModelConfig.paramMapping = {};
            currentModelConfig.paramMapping[sel.dataset.key] = sel.value || null;
        });
    });
}

document.getElementById('btn-apply-suggested').addEventListener('click', () => {
    if (!suggestedMapping) return;
    if (!currentModelConfig.paramMapping) currentModelConfig.paramMapping = {};
    for (const [key, val] of Object.entries(suggestedMapping)) {
        if (val) currentModelConfig.paramMapping[key] = val;
    }
    renderParamMapping();
    showStatus('model-status', t('status.suggestedApplied'), 'success');
});

// Import image folder
document.getElementById('btn-select-image-folder').addEventListener('click', async () => {
    const result = await window.electronAPI.selectImageFolder();
    if (!result.success) {
        if (result.error !== 'cancelled') showStatus('model-status', result.error, 'error');
        return;
    }
    const folderPath = result.folderPath;
    currentModelConfig.imageFolderPath = folderPath;
    currentModelConfig.type = 'image';
    document.getElementById('model-type').value = 'image';
    updateModelCards();

    // Scan folder for images
    showStatus('model-status', t('status.scanningImages'), 'info');
    const scanResult = await window.electronAPI.scanImageFolder(folderPath);
    if (!scanResult.success) {
        showStatus('model-status', scanResult.error, 'error');
        return;
    }

    document.getElementById('folder-info').textContent =
        `${t('status.folderInfo')}${folderPath} (${scanResult.images.length})`;
    document.getElementById('image-list-container').style.display = '';

    // Build imageFiles from scan, preserving existing config if same folder
    const existingFiles = currentModelConfig.imageFiles || [];
    const existingMap = {};
    for (const f of existingFiles) existingMap[f.file] = f;

    currentModelConfig.imageFiles = scanResult.images.map(img => {
        const existing = existingMap[img.filename];
        return existing || { file: img.filename, idle: false, talking: false, emotionName: '' };
    });

    renderImageList(currentModelConfig);
    showStatus('model-status', t('status.imagesScanned').replace('{0}', scanResult.images.length), 'success');
});

function renderImageList(modelConfig) {
    const container = document.getElementById('image-list');
    container.innerHTML = '';
    const files = modelConfig.imageFiles || [];
    const folderPath = (modelConfig.imageFolderPath || '').replace(/\\/g, '/');

    files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'image-item';
        row.dataset.index = i;

        const emotionDisplay = f.emotionName ? '' : 'display:none;';
        row.innerHTML = `
            <img class="image-thumb" src="file:///${folderPath}/${encodeURIComponent(f.file)}" alt="${f.file}">
            <span style="flex:1;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.file}">${f.file}</span>
            <div class="cats">
                <label><input type="checkbox" class="cat-idle" ${f.idle ? 'checked' : ''}> ${t('img.idle')}</label>
                <label><input type="checkbox" class="cat-talking" ${f.talking ? 'checked' : ''}> ${t('img.talking')}</label>
                <label><input type="checkbox" class="cat-emotion" ${f.emotionName ? 'checked' : ''}> ${t('img.emotion')}</label>
                <input type="text" class="emotion-name" value="${f.emotionName || ''}" placeholder="${t('img.emotionPh')}" style="${emotionDisplay}">
            </div>
        `;

        // Toggle emotion name input visibility
        const emotionCb = row.querySelector('.cat-emotion');
        const emotionInput = row.querySelector('.emotion-name');
        emotionCb.addEventListener('change', () => {
            emotionInput.style.display = emotionCb.checked ? '' : 'none';
            if (!emotionCb.checked) emotionInput.value = '';
        });

        container.appendChild(row);
    });
}

function renderImageListFromConfig(modelConfig) {
    // Re-render from saved config (used on load)
    renderImageList(modelConfig);
}

function collectImageFiles() {
    const items = document.querySelectorAll('#image-list .image-item');
    const files = currentModelConfig.imageFiles || [];
    items.forEach((item, i) => {
        if (!files[i]) return;
        files[i].idle = item.querySelector('.cat-idle').checked;
        files[i].talking = item.querySelector('.cat-talking').checked;
        const emotionCb = item.querySelector('.cat-emotion');
        files[i].emotionName = emotionCb.checked
            ? (item.querySelector('.emotion-name').value.trim() || '')
            : '';
    });
    return files;
}

// Bubble frame
document.getElementById('btn-select-bubble').addEventListener('click', async () => {
    const result = await window.electronAPI.selectBubbleImage();
    if (!result.success) return;
    document.getElementById('bubble-info').textContent = `${t('status.bubbleInfo')}${result.filePath}`;
    // Save to config
    await window.electronAPI.saveConfig({ bubble: { frameImagePath: result.filePath } });
});

document.getElementById('btn-clear-bubble').addEventListener('click', async () => {
    document.getElementById('bubble-info').textContent = '';
    await window.electronAPI.saveConfig({ bubble: { frameImagePath: null } });
});

// App icon
document.getElementById('btn-select-icon').addEventListener('click', async () => {
    const result = await window.electronAPI.selectAppIcon();
    if (!result.success) return;
    document.getElementById('icon-preview').src = result.iconPath;
    document.getElementById('icon-preview').style.display = '';
    document.getElementById('icon-info').textContent = `${t('status.iconInfo')}${result.iconPath}`;
    await window.electronAPI.saveConfig({ appIcon: result.iconPath });
});

// Save model config
document.getElementById('btn-save-model').addEventListener('click', async () => {
    // Collect image folder data if in image mode
    if (currentModelConfig.type === 'image' && currentModelConfig.imageFolderPath) {
        currentModelConfig.imageFiles = collectImageFiles();
        currentModelConfig.imageCropScale = parseFloat(
            document.getElementById('image-crop-slider').value
        ) || 1.0;

        // Auto-generate expressions from emotion names for the emotion system
        const emotionNames = new Set();
        for (const f of currentModelConfig.imageFiles) {
            if (f.emotionName) emotionNames.add(f.emotionName);
        }
        if (emotionNames.size > 0) {
            currentModelConfig.hasExpressions = true;
            currentModelConfig.expressions = [...emotionNames].map(name => ({
                name, label: name, file: ''
            }));
        } else {
            currentModelConfig.hasExpressions = false;
            currentModelConfig.expressions = [];
        }
    }

    await window.electronAPI.saveConfig({ model: currentModelConfig });
    showStatus('model-status', t('status.modelSaved'), 'success');
});

// Clear model
document.getElementById('btn-clear-model').addEventListener('click', async () => {
    currentModelConfig = {
        type: 'none', folderPath: null, modelJsonFile: null,
        copyToUserData: true, userDataModelPath: null,
        staticImagePath: null, bottomAlignOffset: 0.5,
        gifExpressions: {},
        imageFolderPath: null, imageFiles: [], imageCropScale: 1.0,
        paramMapping: { angleX: null, angleY: null, angleZ: null, bodyAngleX: null, eyeBallX: null, eyeBallY: null },
        hasExpressions: false, expressions: [],
        expressionDurations: {}, defaultExpressionDuration: 5000,
        motionEmotions: [], motionDurations: {}, defaultMotionDuration: 3000,
        canvasYRatio: 0.60
    };
    await window.electronAPI.saveConfig({ model: currentModelConfig });
    document.getElementById('model-type').value = 'none';
    document.getElementById('image-list').innerHTML = '';
    document.getElementById('image-list-container').style.display = 'none';
    document.getElementById('folder-info').textContent = '';
    updateModelCards();
    showStatus('model-status', t('status.modelCleared'), 'success');
});

// ========== Emotion Tab ==========
function loadEmotionUI(fileConfig) {
    if (!fileConfig) return;
    if (fileConfig.emotionFrequency) {
        document.getElementById('emotion-frequency').value = fileConfig.emotionFrequency;
    }
    if (fileConfig.allowSimultaneous) {
        document.getElementById('allow-simultaneous').checked = true;
    }
    if (fileConfig.model && fileConfig.model.defaultExpressionDuration) {
        document.getElementById('default-expr-duration').value = fileConfig.model.defaultExpressionDuration / 1000;
    }
    if (fileConfig.model && fileConfig.model.defaultMotionDuration) {
        document.getElementById('default-motion-duration').value = fileConfig.model.defaultMotionDuration / 1000;
    }
    renderExpressionList(fileConfig.model);
    renderMotionList(fileConfig.model);
}

function renderExpressionList(modelConfig) {
    const container = document.getElementById('expression-list');
    container.innerHTML = '';
    const expressions = (modelConfig && modelConfig.expressions) || [];
    const durations = (modelConfig && modelConfig.expressionDurations) || {};
    const enabledList = [];

    if (expressions.length === 0) {
        document.getElementById('expr-hint').style.display = '';
        return;
    }
    document.getElementById('expr-hint').style.display = 'none';

    expressions.forEach((expr, i) => {
        const durMs = durations[expr.name];
        const durSec = durMs ? (durMs / 1000) : '';
        const row = document.createElement('div');
        row.className = 'expr-item';
        row.innerHTML = `
            <input type="checkbox" class="expr-enabled" data-name="${expr.name}" checked>
            <input type="text" class="expr-name" value="${expr.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <span style="color:#888;font-size:11px;">${expr.file || ''}</span>
            <input type="number" class="expr-dur" value="${durSec}" placeholder="${t('status.default')}" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${expr.name}">
            <span style="color:#888;font-size:11px;">${t('sec')}</span>
            <button class="btn btn-danger btn-sm expr-del" data-index="${i}" style="padding:2px 8px;">✕</button>
        `;
        container.appendChild(row);
    });

    // Delete expression
    container.querySelectorAll('.expr-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            currentModelConfig.expressions.splice(idx, 1);
            renderExpressionList(currentModelConfig);
        });
    });
}

document.getElementById('btn-add-expr').addEventListener('click', () => {
    if (!currentModelConfig.expressions) currentModelConfig.expressions = [];
    currentModelConfig.expressions.push({ name: t('status.newExpr'), label: t('status.newExpr'), file: '' });
    currentModelConfig.hasExpressions = true;
    renderExpressionList(currentModelConfig);
});

// ========== Motion List ==========
function renderMotionList(modelConfig) {
    const container = document.getElementById('motion-list');
    container.innerHTML = '';
    const motionEmotions = (modelConfig && modelConfig.motionEmotions) || [];
    const durations = (modelConfig && modelConfig.motionDurations) || {};

    if (motionEmotions.length === 0) {
        document.getElementById('motion-hint').style.display = '';
        return;
    }
    document.getElementById('motion-hint').style.display = 'none';

    // Build group options from scanned motions
    const groupOptions = Object.keys(scannedMotions);

    motionEmotions.forEach((m, i) => {
        const durMs = durations[m.name];
        const durSec = durMs ? (durMs / 1000) : '';
        const maxIdx = scannedMotions[m.group] ? scannedMotions[m.group].length - 1 : 99;
        const row = document.createElement('div');
        row.className = 'expr-item';
        row.innerHTML = `
            <input type="checkbox" class="motion-enabled" data-name="${m.name}" checked>
            <input type="text" class="motion-name" value="${m.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <select class="motion-group" data-index="${i}" style="width:80px;padding:2px 4px;font-size:12px;">
                ${groupOptions.map(g => `<option value="${g}" ${g === m.group ? 'selected' : ''}>${g}</option>`).join('')}
                ${!groupOptions.includes(m.group) ? `<option value="${m.group}" selected>${m.group}</option>` : ''}
            </select>
            <input type="number" class="motion-index" value="${m.index}" min="0" max="${maxIdx}" style="width:45px;padding:2px 4px;font-size:12px;" data-index="${i}">
            <input type="number" class="motion-dur" value="${durSec}" placeholder="${t('status.default')}" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${m.name}">
            <span style="color:#888;font-size:11px;">${t('sec')}</span>
            <button class="btn btn-danger btn-sm motion-del" data-index="${i}" style="padding:2px 8px;">✕</button>
        `;
        container.appendChild(row);
    });

    // Delete motion
    container.querySelectorAll('.motion-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            currentModelConfig.motionEmotions.splice(idx, 1);
            renderMotionList(currentModelConfig);
        });
    });
}

document.getElementById('btn-add-motion').addEventListener('click', () => {
    if (!currentModelConfig.motionEmotions) currentModelConfig.motionEmotions = [];
    const firstGroup = Object.keys(scannedMotions)[0] || 'Default';
    currentModelConfig.motionEmotions.push({ name: t('status.newMotion'), group: firstGroup, index: 0 });
    renderMotionList(currentModelConfig);
});

document.getElementById('btn-save-emotion-freq').addEventListener('click', () => {
    if (!petSystem || !petSystem.emotionSystem) return;
    const freq = parseInt(document.getElementById('emotion-frequency').value);
    const simultaneous = document.getElementById('allow-simultaneous').checked;
    petSystem.emotionSystem.setExpectedFrequency(freq);
    petSystem.emotionSystem.allowSimultaneous = simultaneous;
    if (window.electronAPI) window.electronAPI.saveConfig({ allowSimultaneous: simultaneous });
    showStatus('emotion-status', t('status.saved'), 'success');
});

document.getElementById('btn-save-expressions').addEventListener('click', async () => {
    // Collect expression data from UI
    const container = document.getElementById('expression-list');
    const names = container.querySelectorAll('.expr-name');
    const durs = container.querySelectorAll('.expr-dur');
    const enabled = container.querySelectorAll('.expr-enabled');

    const expressions = [];
    const expressionDurations = {};
    const enabledEmotions = [];

    names.forEach((nameInput, i) => {
        const name = nameInput.value.trim();
        if (!name) return;
        const expr = currentModelConfig.expressions[i] || {};
        expressions.push({ name, label: name, file: expr.file || '' });
        const durSec = parseFloat(durs[i]?.value);
        if (durSec > 0) expressionDurations[name] = Math.round(durSec * 1000);
        if (enabled[i]?.checked) enabledEmotions.push(name);
    });

    // Collect motion data from UI
    const motionContainer = document.getElementById('motion-list');
    const motionNames = motionContainer.querySelectorAll('.motion-name');
    const motionGroups = motionContainer.querySelectorAll('.motion-group');
    const motionIndices = motionContainer.querySelectorAll('.motion-index');
    const motionDurs = motionContainer.querySelectorAll('.motion-dur');
    const motionEnabled = motionContainer.querySelectorAll('.motion-enabled');

    const motionEmotions = [];
    const motionDurations = {};

    motionNames.forEach((nameInput, i) => {
        const name = nameInput.value.trim();
        if (!name) return;
        const group = motionGroups[i]?.value || 'Default';
        const index = parseInt(motionIndices[i]?.value) || 0;
        motionEmotions.push({ name, group, index });
        const durSec = parseFloat(motionDurs[i]?.value);
        if (durSec > 0) motionDurations[name] = Math.round(durSec * 1000);
        if (motionEnabled[i]?.checked) enabledEmotions.push(name);
    });

    const defaultDurSec = parseFloat(document.getElementById('default-expr-duration').value);
    const defaultDur = defaultDurSec > 0 ? Math.round(defaultDurSec * 1000) : 5000;
    const defaultMotionDurSec = parseFloat(document.getElementById('default-motion-duration').value);
    const defaultMotionDur = defaultMotionDurSec > 0 ? Math.round(defaultMotionDurSec * 1000) : 3000;

    currentModelConfig.expressions = expressions;
    currentModelConfig.expressionDurations = expressionDurations;
    currentModelConfig.defaultExpressionDuration = defaultDur;
    currentModelConfig.hasExpressions = expressions.length > 0;
    currentModelConfig.motionEmotions = motionEmotions;
    currentModelConfig.motionDurations = motionDurations;
    currentModelConfig.defaultMotionDuration = defaultMotionDur;

    await window.electronAPI.saveConfig({
        model: currentModelConfig,
        enabledEmotions
    });

    // Update emotion system
    if (petSystem && petSystem.emotionSystem) {
        petSystem.emotionSystem.configureExpressions(expressions, expressionDurations, defaultDur);
        petSystem.emotionSystem.configureMotions(motionEmotions, motionDurations, defaultMotionDur);
        petSystem.emotionSystem.setEnabledEmotions(enabledEmotions);
    }

    showStatus('save-emotion-status', t('status.exprSaved'), 'success');
});

// ========== Character Card Management ==========

let currentCharacterId = null;

function fillPromptFields(data) {
    document.getElementById('prompt-name').value = data.name || '';
    document.getElementById('prompt-user-identity').value = data.userIdentity || '';
    document.getElementById('prompt-user-term').value = data.userTerm || '';
    document.getElementById('prompt-desc').value = data.description || '';
    document.getElementById('prompt-personality').value = data.personality || '';
    document.getElementById('prompt-scenario').value = data.scenario || '';
    document.getElementById('prompt-rules').value = data.rules || '';
    document.getElementById('prompt-language').value = data.language || '';
    const ha = data.hitActions || {};
    document.getElementById('prompt-hit-click').value = ha.click || '';
    document.getElementById('prompt-hit-touch').value = ha.touch || '';
    document.getElementById('prompt-hit-drag').value = ha.drag || '';
    document.getElementById('prompt-hit-swipe').value = ha.swipe || '';
    document.getElementById('prompt-hit-resize').value = ha.resize || '';
}

async function loadCharacterList() {
    if (!window.electronAPI?.listCharacters) return;
    const { characters, activeCharacterId } = await window.electronAPI.listCharacters();
    const select = document.getElementById('character-select');
    select.innerHTML = '';
    for (const c of characters) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.builtin ? `${c.name} ${t('card.builtin')}` : c.name;
        select.appendChild(opt);
    }
    select.value = activeCharacterId;
    currentCharacterId = activeCharacterId;
    await loadCharacterPrompt(activeCharacterId);
}

async function loadCharacterPrompt(id) {
    if (!window.electronAPI?.loadPrompt) return;
    const result = await window.electronAPI.loadPrompt(id);
    if (result.success) {
        currentCharacterId = result.id || id;
        // Resolve i18n for built-in cards (display in current UI language)
        let data = { ...result.data };
        if (result.i18n && currentLang && result.i18n[currentLang]) {
            Object.assign(data, result.i18n[currentLang]);
        }
        fillPromptFields(data);
    }
}

async function reloadPetPrompt() {
    if (petSystem && petSystem.promptBuilder) {
        await petSystem.promptBuilder.loadCharacterPrompt(currentCharacterId, currentLang);
        petSystem.systemPrompt = petSystem.promptBuilder.buildSystemPrompt();
    }
}

document.getElementById('character-select').addEventListener('change', async (e) => {
    const id = e.target.value;
    await window.electronAPI.setActiveCharacter(id);
    currentCharacterId = id;
    await loadCharacterPrompt(id);
    await reloadPetPrompt();
    showStatus('prompt-status', t('status.switched'), 'success');
});

// Inline name input helper
let _nameAction = null; // 'new' | 'rename'

function showNameInput(defaultValue, action) {
    _nameAction = action;
    const row = document.getElementById('character-name-input-row');
    const input = document.getElementById('character-name-input');
    input.value = defaultValue || '';
    row.style.display = 'flex';
    input.focus();
    input.select();
}

function hideNameInput() {
    document.getElementById('character-name-input-row').style.display = 'none';
    _nameAction = null;
}

document.getElementById('btn-confirm-name').addEventListener('click', async () => {
    const name = document.getElementById('character-name-input').value.trim();
    if (!name) return;
    if (_nameAction === 'new') {
        const result = await window.electronAPI.createCharacter(name);
        if (result.success) {
            await window.electronAPI.setActiveCharacter(result.id);
            await loadCharacterList();
            showStatus('prompt-status', t('status.created') + name, 'success');
        }
    } else if (_nameAction === 'rename' && currentCharacterId) {
        const result = await window.electronAPI.renameCharacter(currentCharacterId, name);
        if (result.success) {
            await loadCharacterList();
            showStatus('prompt-status', t('status.renamed'), 'success');
        }
    }
    hideNameInput();
});

document.getElementById('btn-cancel-name').addEventListener('click', hideNameInput);

document.getElementById('character-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-name').click();
    if (e.key === 'Escape') hideNameInput();
});

document.getElementById('btn-new-character').addEventListener('click', () => {
    showNameInput('', 'new');
});

document.getElementById('btn-import-character').addEventListener('click', async () => {
    const result = await window.electronAPI.importCharacter();
    if (result.success && result.imported.length > 0) {
        const last = result.imported[result.imported.length - 1];
        await window.electronAPI.setActiveCharacter(last.id);
        await loadCharacterList();
        showStatus('prompt-status', t('status.created') + last.name, 'success');
    }
});

document.getElementById('btn-rename-character').addEventListener('click', () => {
    if (!currentCharacterId) return;
    const select = document.getElementById('character-select');
    const currentName = select.options[select.selectedIndex]?.textContent || '';
    showNameInput(currentName, 'rename');
});

document.getElementById('btn-delete-character').addEventListener('click', async () => {
    if (!currentCharacterId) return;
    const result = await window.electronAPI.deleteCharacter(currentCharacterId);
    if (result.success) {
        await loadCharacterList();
        await reloadPetPrompt();
        showStatus('prompt-status', t('status.deleted'), 'success');
    } else {
        showStatus('prompt-status', result.error, 'error');
    }
});

document.getElementById('btn-reset-builtin').addEventListener('click', async () => {
    if (!window.electronAPI?.resetBuiltinCards) return;
    const result = await window.electronAPI.resetBuiltinCards();
    if (result.success) {
        await loadCharacterList();
        await loadCharacterPrompt(currentCharacterId);
        await reloadPetPrompt();
        showStatus('prompt-status', t('status.builtinReset'), 'success');
    }
});

document.getElementById('btn-save-prompt').addEventListener('click', async () => {
    if (!currentCharacterId) return;
    const promptData = {
        name: document.getElementById('prompt-name').value,
        userIdentity: document.getElementById('prompt-user-identity').value,
        userTerm: document.getElementById('prompt-user-term').value,
        description: document.getElementById('prompt-desc').value,
        personality: document.getElementById('prompt-personality').value,
        scenario: document.getElementById('prompt-scenario').value,
        rules: document.getElementById('prompt-rules').value,
        language: document.getElementById('prompt-language').value,
        hitActions: {
            click: document.getElementById('prompt-hit-click').value.trim(),
            touch: document.getElementById('prompt-hit-touch').value.trim(),
            drag: document.getElementById('prompt-hit-drag').value.trim(),
            swipe: document.getElementById('prompt-hit-swipe').value.trim(),
            resize: document.getElementById('prompt-hit-resize').value.trim()
        }
    };
    const result = await window.electronAPI.savePrompt(currentCharacterId, promptData);
    if (result.success) {
        showStatus('prompt-status', t('status.saved'), 'success');
        await reloadPetPrompt();
    } else {
        showStatus('prompt-status', t('status.saveFail') + result.error, 'error');
    }
});

// ========== TTS Settings ==========

let ttsMetas = [];

async function loadTTSStatus() {
    if (!window.electronAPI || !window.electronAPI.ttsGetStatus) return;
    const status = await window.electronAPI.ttsGetStatus();
    const el = document.getElementById('tts-status');
    const restartBtn = document.getElementById('btn-restart-tts');
    if (status.initialized) {
        if (status.degraded) {
            const elapsed = Date.now() - status.degradedAt;
            const remaining = Math.max(0, Math.ceil((status.retryInterval - elapsed) / 1000));
            el.textContent = t('tts.circuitBreak').replace('{0}', remaining);
            el.className = 'status error';
            restartBtn.style.display = '';
        } else {
            el.textContent = t('tts.ready') + (status.gpuMode ? t('tts.readyGpu') : t('tts.readyCpu'));
            el.className = 'status success';
            restartBtn.style.display = 'none';
        }
        document.getElementById('tts-hint').style.display = 'none';
        // Load metas and populate dropdowns
        ttsMetas = await window.electronAPI.ttsGetMetas();
        populateSpeakerDropdown();
    } else {
        el.textContent = t('tts.offline');
        el.className = 'status error';
        restartBtn.style.display = '';
    }
    const config = await window.electronAPI.loadConfig();
    if (config.tts) {
        document.getElementById('tts-speed').value = config.tts.speedScale || 1.0;
        document.getElementById('tts-pitch').value = config.tts.pitchScale || 0.0;
        document.getElementById('tts-volume').value = config.tts.volumeScale || 1.0;
        document.getElementById('tts-speed-val').textContent = config.tts.speedScale || 1.0;
        document.getElementById('tts-pitch-val').textContent = config.tts.pitchScale || 0.0;
        document.getElementById('tts-volume-val').textContent = config.tts.volumeScale || 1.0;
        // Restore audio mode
        const audioMode = config.tts.audioMode || 'tts';
        const radio = document.querySelector(`input[name="audio-mode"][value="${audioMode}"]`);
        if (radio) radio.checked = true;
        // Restore saved speaker + style selection
        if (config.tts.styleId !== undefined) {
            selectStyleById(config.tts.styleId);
        }
        // Restore GPU mode checkbox
        const gpuCheckbox = document.getElementById('tts-gpu-mode');
        if (gpuCheckbox) gpuCheckbox.checked = config.tts.gpuMode || false;
    }
}

function populateSpeakerDropdown() {
    const speakerSel = document.getElementById('tts-speaker');
    speakerSel.innerHTML = '';
    ttsMetas.forEach((speaker, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = speaker.name;
        speakerSel.appendChild(opt);
    });
    speakerSel.addEventListener('change', () => populateStyleDropdown(parseInt(speakerSel.value)));
    if (ttsMetas.length > 0) populateStyleDropdown(0);
}

function populateStyleDropdown(speakerIdx) {
    const styleSel = document.getElementById('tts-style-id');
    styleSel.innerHTML = '';
    const speaker = ttsMetas[speakerIdx];
    if (!speaker) return;
    speaker.styles.forEach(style => {
        const opt = document.createElement('option');
        opt.value = style.id;
        opt.textContent = style.name;
        styleSel.appendChild(opt);
    });
}

function selectStyleById(styleId) {
    for (let i = 0; i < ttsMetas.length; i++) {
        const idx = ttsMetas[i].styles.findIndex(s => s.id === styleId);
        if (idx >= 0) {
            document.getElementById('tts-speaker').value = i;
            populateStyleDropdown(i);
            document.getElementById('tts-style-id').value = styleId;
            return;
        }
    }
}

['tts-speed', 'tts-pitch', 'tts-volume'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
        document.getElementById(id + '-val').textContent = el.value;
    });
});

document.getElementById('btn-save-tts').addEventListener('click', async () => {
    const ttsConfig = {
        styleId: parseInt(document.getElementById('tts-style-id').value),
        speedScale: parseFloat(document.getElementById('tts-speed').value),
        pitchScale: parseFloat(document.getElementById('tts-pitch').value),
        volumeScale: parseFloat(document.getElementById('tts-volume').value)
    };
    await window.electronAPI.ttsSetConfig(ttsConfig);
    // Save audio mode to config (only send tts section to avoid triggering model reload)
    const audioMode = document.querySelector('input[name="audio-mode"]:checked')?.value || 'tts';
    await window.electronAPI.saveConfig({
        tts: {
            audioMode,
            styleId: ttsConfig.styleId,
            speedScale: ttsConfig.speedScale,
            pitchScale: ttsConfig.pitchScale,
            volumeScale: ttsConfig.volumeScale,
            gpuMode: document.getElementById('tts-gpu-mode')?.checked || false
        }
    });
    showStatus('tts-save-status', t('status.saved'), 'success');
});

document.getElementById('btn-test-tts').addEventListener('click', async () => {
    const text = document.getElementById('tts-test-text').value.trim();
    if (!text) return;
    showStatus('tts-test-status', t('tts.synthesizing'), '');
    const result = await window.electronAPI.ttsSynthesize(text);
    if (result.success) {
        showStatus('tts-test-status', t('tts.translated') + result.jaText, 'success');
        const wavBytes = Uint8Array.from(atob(result.wav), c => c.charCodeAt(0));
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
    } else {
        showStatus('tts-test-status', t('tts.synthFailed') + result.error, 'error');
    }
});

loadTTSStatus();

// Restart TTS button
document.getElementById('btn-restart-tts')?.addEventListener('click', async () => {
    const el = document.getElementById('tts-status');
    el.textContent = t('tts.restarting');
    el.className = 'status';
    const result = await window.electronAPI.ttsRestart();
    if (result.success) {
        await loadTTSStatus();
    } else {
        el.textContent = t('tts.restartFailed') + (result.error || t('tts.unknownError'));
        el.className = 'status error';
    }
});

// One-click VOICEVOX setup
document.getElementById('btn-setup-voicevox')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-setup-voicevox');
    const status = document.getElementById('voicevox-setup-status');
    btn.disabled = true;
    btn.textContent = t('tts.installing');
    status.textContent = t('tts.preparing');
    status.className = 'status';

    if (window.electronAPI.onVoicevoxSetupProgress) {
        window.electronAPI.onVoicevoxSetupProgress((msg) => {
            status.textContent = msg;
        });
    }

    const result = await window.electronAPI.setupVoicevox();
    btn.disabled = false;
    btn.textContent = t('tts.setup');
    if (result.success) {
        status.textContent = t('tts.installDone');
        status.className = 'status success';
        // Auto-restart TTS
        const restartResult = await window.electronAPI.ttsRestart();
        if (restartResult.success) {
            await loadTTSStatus();
            status.textContent = t('tts.installDoneTts');
        }
    } else {
        status.textContent = t('tts.installFail') + result.error;
        status.className = 'status error';
    }
});

// Default audio generation
document.getElementById('btn-generate-default-audio')?.addEventListener('click', async () => {
    const textarea = document.getElementById('default-audio-phrases');
    const phrases = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (phrases.length === 0) {
        showStatus('default-audio-status', t('tts.enterPhrase'), 'error');
        return;
    }
    const styleId = parseInt(document.getElementById('tts-style-id').value) || 0;
    showStatus('default-audio-status', t('tts.generating').replace('{0}', phrases.length), '');
    const result = await window.electronAPI.generateDefaultAudio(phrases, styleId);
    if (result.success) {
        const ok = result.results.filter(r => r.success).length;
        showStatus('default-audio-status', t('tts.generateDone').replace('{0}', ok).replace('{1}', phrases.length), 'success');
    } else {
        showStatus('default-audio-status', t('status.failed') + result.error, 'error');
    }
});

// Load saved phrases into textarea
(async () => {
    const config = await window.electronAPI?.loadConfig();
    if (config?.tts?.defaultPhrases) {
        const textarea = document.getElementById('default-audio-phrases');
        if (textarea) textarea.value = config.tts.defaultPhrases.join('\n');
    }
})();

// VVM config
const VVM_CHARACTERS = {
    '0.vvm': '四国めたん, ずんだもん, 春日部つむぎ, 雨晴はう',
    '1.vvm': '冥鳴ひまり',
    '2.vvm': '九州そら',
    '3.vvm': '波音リツ, 中国うさぎ',
    '4.vvm': '玄野武宏, 剣崎雌雄',
    '5.vvm': '四国めたん(ささやき), ずんだもん(ささやき), 九州そら(ささやき)',
    '6.vvm': 'No.7',
    '7.vvm': '後鬼',
    '8.vvm': 'WhiteCUL',
    '9.vvm': '白上虎太郎',
    '10.vvm': '玄野武宏(追加), ちび式じい',
    '11.vvm': '櫻歌ミコ, ナースロボ＿タイプＴ',
    '12.vvm': '†聖騎士 紅桜†, 雀松朱司, 麒ヶ島宗麟',
    '13.vvm': '春歌ナナ, 猫使アル, 猫使ビィ',
    '14.vvm': '栗田まろん, あいえるたん, 満別花丸, 琴詠ニア',
    '15.vvm': 'ずんだもん(追加), 青山龍星, もち子さん, 小夜/SAYO',
    '16.vvm': '後鬼(追加)',
    '17.vvm': 'Voidoll',
    '18.vvm': 'ぞん子, 中部つるぎ',
    '19.vvm': '離途, 黒沢冴白',
    '20.vvm': 'ユーレイちゃん',
    '21.vvm': '東北ずん子, 東北きりたん, 東北イタコ, 猫使(追加)',
    '22.vvm': 'あんこもん',
    '23.vvm': 'あんこもん(ささやき)',
    'n0.vvm': 'VOICEVOX Nemo (女声1-6, 男声1-3)',
};

async function loadVvmConfig() {
    if (!window.electronAPI?.ttsGetAvailableVvms) return;
    const available = await window.electronAPI.ttsGetAvailableVvms();
    const config = await window.electronAPI.loadConfig();
    const loaded = config.tts?.vvmFiles || ['0.vvm'];
    const container = document.getElementById('vvm-checkboxes');
    if (!container) return;

    const allVvms = Object.keys(VVM_CHARACTERS);
    container.innerHTML = allVvms.map(f => {
        const onDisk = available.includes(f);
        const checked = loaded.includes(f) && onDisk ? 'checked' : '';
        const disabled = onDisk ? '' : 'disabled';
        const desc = VVM_CHARACTERS[f] || '';
        const dlBtn = onDisk
            ? '<span style="color:#4a4;font-size:11px;">OK</span>'
            : `<button class="btn-dl-vvm" data-vvm="${f}" style="font-size:11px;padding:1px 6px;cursor:pointer;">${t('tts.vvm.dl')}</button>`;
        return `<label style="display:flex;align-items:center;gap:4px;padding:2px 0;font-size:12px;">
            <input type="checkbox" value="${f}" ${checked} ${disabled}>
            <b>${f}</b> ${desc} ${dlBtn}
        </label>`;
    }).join('');

    container.querySelectorAll('.btn-dl-vvm').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const vvm = btn.dataset.vvm;
            btn.textContent = '...';
            btn.disabled = true;
            const result = await window.electronAPI.downloadVvm(vvm);
            if (result.success) {
                // Auto-add downloaded VVM to config and restart TTS
                const config = await window.electronAPI.loadConfig();
                const vvmFiles = config.tts?.vvmFiles || ['0.vvm'];
                if (!vvmFiles.includes(vvm)) {
                    vvmFiles.push(vvm);
                    await window.electronAPI.saveConfig({ tts: { vvmFiles } });
                }
                await loadVvmConfig();
                await window.electronAPI.ttsRestart();
                showStatus('vvm-save-status', t('tts.vvm.saved'), 'success');
            } else {
                btn.textContent = t('status.failed');
                showStatus('vvm-save-status', t('tts.vvm.dlFail') + result.error, 'error');
            }
        });
    });
}

document.getElementById('btn-save-vvm')?.addEventListener('click', async () => {
    const checks = document.querySelectorAll('#vvm-checkboxes input[type=checkbox]:checked');
    const vvmFiles = Array.from(checks).map(c => c.value);
    if (vvmFiles.length === 0) {
        showStatus('vvm-save-status', t('tts.vvm.selectOne'), 'error');
        return;
    }
    // Only save changed vvm list, not the full config
    await window.electronAPI.saveConfig({ tts: { vvmFiles } });
    // Relaunch app to apply VVM changes
    await window.electronAPI.appRelaunch();
});

loadVvmConfig();

// ========== Max Tokens Multiplier ==========

function loadTokenMultiplierUI(multiplier) {
    updateTokenButtons(multiplier);
    updateTokenInfo(multiplier);
}

function updateTokenButtons(multiplier) {
    document.querySelectorAll('.token-mult-btn').forEach(btn => {
        const val = parseFloat(btn.dataset.mult);
        btn.className = val === multiplier
            ? 'btn btn-primary btn-sm token-mult-btn'
            : 'btn btn-secondary btn-sm token-mult-btn';
    });
}

function updateTokenInfo(multiplier) {
    const el = document.getElementById('token-info');
    if (el) {
        const tokens = Math.round(2048 * multiplier);
        el.textContent = t('enhance.tokens.info').replace('{0}', tokens).replace('{1}', multiplier);
    }
}

document.querySelectorAll('.token-mult-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mult = parseFloat(btn.dataset.mult);
        if (petSystem && petSystem.aiClient) {
            petSystem.aiClient.maxTokensMultiplier = mult;
            petSystem.aiClient.saveConfig({ maxTokensMultiplier: mult });
        }
        updateTokenButtons(mult);
        updateTokenInfo(mult);
    });
});

// ========== Enhance Master Toggle ==========

function loadEnhanceToggle(enhance) {
    document.getElementById('enhance-enabled').checked = enhance.enabled || false;
}

document.getElementById('enhance-enabled').addEventListener('change', async () => {
    const enabled = document.getElementById('enhance-enabled').checked;
    await window.electronAPI.saveConfig({ enhance: { enabled } });
});

// ========== Startup Message ==========

function loadStartupConfig(startup) {
    const enabledEl = document.getElementById('startup-enabled');
    const messagesEl = document.getElementById('startup-messages');
    if (enabledEl) enabledEl.checked = startup.enabled !== false;

    // 兼容旧配置
    let messages = [];
    if (Array.isArray(startup.messages) && startup.messages.length > 0) {
        messages = startup.messages;
    } else if (startup.messageTemplate) {
        messages = [startup.messageTemplate];
    } else {
        messages = ['欢迎回来，{name}', '{name}，今天也要加油哦', '又见面了，{name}'];
    }
    if (messagesEl) messagesEl.value = messages.join('\n');
}

document.getElementById('btn-save-startup')?.addEventListener('click', async () => {
    const enabled = document.getElementById('startup-enabled').checked;
    const raw = document.getElementById('startup-messages').value;
    const messages = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (messages.length === 0) {
        showStatus('startup-status', t('startup.emptyList'), 'error');
        return;
    }
    await window.electronAPI.saveConfig({ startup: { enabled, messages } });
    showStatus('startup-status', t('status.saved'), 'success');
});

document.getElementById('btn-test-startup')?.addEventListener('click', async () => {
    const raw = document.getElementById('startup-messages').value;
    const messages = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (messages.length === 0) {
        showStatus('startup-status', t('startup.emptyList'), 'error');
        return;
    }
    // 随机选一条
    const template = messages[Math.floor(Math.random() * messages.length)];

    let name = '哥哥';
    try {
        const profile = JSON.parse(localStorage.getItem('live2dpet_user_profile') || '{}');
        if (profile.name) name = profile.name;
    } catch {}
    const message = template.replace(/\{name\}/g, name);

    showStatus('startup-status', t('startup.testing'), '');
    try {
        const result = await window.electronAPI.ttsSynthesize(message);
        if (result.success && result.wav) {
            const wavBytes = Uint8Array.from(atob(result.wav), c => c.charCodeAt(0));
            const blob = new Blob([wavBytes], { type: 'audio/wav' });
            const audio = new Audio(URL.createObjectURL(blob));
            audio.play();
            showStatus('startup-status', `🔊 ${message}`, 'success');
        } else {
            showStatus('startup-status', t('startup.ttsFail'), 'error');
        }
    } catch (err) {
        showStatus('startup-status', t('startup.ttsFail') + ' ' + err.message, 'error');
    }
});
// ========== Agent 工具策略 ==========

const TOOL_LABELS = {
    read_file: 'read_file（读文件）',
    list_dir: 'list_dir（列目录）',
    list_dir_tree: 'list_dir_tree（递归列目录）',
    search_files: 'search_files（搜索文件名）',
    grep_text: 'grep_text（搜索内容）',
    write_file: 'write_file（写文件）',
    open_url: 'open_url（打开链接）'
};

const DEFAULT_POLICIES = {
    read_file: 'allow',
    list_dir: 'allow',
    list_dir_tree: 'allow',
    search_files: 'allow',
    grep_text: 'allow',
    write_file: 'ask',
    open_url: 'ask'
};

async function loadToolPolicies() {
    const container = document.getElementById('tool-policies-list');
    if (!container) return;

    let policies = { ...DEFAULT_POLICIES };
    try {
        const r = await window.electronAPI.getToolPolicies();
        if (r.success && r.policies) policies = { ...DEFAULT_POLICIES, ...r.policies };
    } catch {}

    container.innerHTML = '';
    for (const [name, label] of Object.entries(TOOL_LABELS)) {
        const row = document.createElement('div');
        row.className = 'param-row';
        const val = policies[name] || 'ask';
        row.innerHTML = `
            <span class="param-label" style="width:220px;">${label}</span>
            <select class="tool-policy-select" data-tool="${name}" style="flex:1;padding:4px;font-size:12px;border-radius:4px;">
                <option value="allow" ${val === 'allow' ? 'selected' : ''}>allow（直接执行）</option>
                <option value="ask" ${val === 'ask' ? 'selected' : ''}>ask（每次询问）</option>
                <option value="deny" ${val === 'deny' ? 'selected' : ''}>deny（禁止）</option>
            </select>
        `;
        container.appendChild(row);
    }
}

document.getElementById('btn-save-tool-policies')?.addEventListener('click', async () => {
    const policies = {};
    document.querySelectorAll('.tool-policy-select').forEach(sel => {
        policies[sel.dataset.tool] = sel.value;
    });
    const r = await window.electronAPI.setToolPolicies(policies);
    if (r.success) {
        showStatus('tool-policies-status', t('status.saved'), 'success');
        // 通知 petSystem 刷新策略
        if (petSystem && petSystem.refreshToolPolicies) {
            await petSystem.refreshToolPolicies();
        }
    } else {
        showStatus('tool-policies-status', t('status.saveFail') + r.error, 'error');
    }
});

// 页面加载时读取
setTimeout(() => loadToolPolicies(), 500);
// ========== MCP Server 管理 ==========

let mcpServers = [];
let mcpRuntimeStatus = {};   // id -> {status, toolCount, error}
let mcpEditingId = null;     // null = 添加新，非 null = 编辑

async function loadMcpTab() {
    try {
        // 1. 读配置里的 servers
        const config = await window.electronAPI.loadConfig();
        mcpServers = config.mcp?.servers || [];

        // 2. 读运行时状态
        const r = await window.electronAPI.mcpGetStatus();
        if (r.success && Array.isArray(r.servers)) {
            mcpRuntimeStatus = {};
            for (const s of r.servers) {
                mcpRuntimeStatus[s.id] = s;
            }
        }
    } catch (err) {
        console.warn('[MCP UI] load failed:', err);
    }
    renderMcpServers();
}

function renderMcpServers() {
    const container = document.getElementById('mcp-server-list');
    if (!container) return;
    container.innerHTML = '';

    if (mcpServers.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'model-info';
        hint.textContent = '还没有配置 MCP Server';
        container.appendChild(hint);
        return;
    }

    mcpServers.forEach((s, idx) => {
        const rt = mcpRuntimeStatus[s.id];
        let dot = '⚪';        // 未运行
        let statusText = '未运行';
        if (rt) {
            if (rt.status === 'running') { dot = '🟢'; statusText = '运行中'; }
            else if (rt.status === 'error') { dot = '🔴'; statusText = '错误'; }
            else if (rt.status === 'starting') { dot = '🟡'; statusText = '启动中'; }
            else if (rt.status === 'stopped') { dot = '⚪'; statusText = '已停止'; }
        }
        if (s.enabled === false) { dot = '⚫'; statusText = '已禁用'; }

        const toolCount = rt?.toolCount || 0;

        const row = document.createElement('div');
        row.className = 'expr-item';
        row.style.flexWrap = 'wrap';
        row.style.gap = '6px';

        const dotEl = document.createElement('span');
        dotEl.style.fontSize = '14px';
        dotEl.textContent = dot;
        row.appendChild(dotEl);

        const nameEl = document.createElement('span');
        nameEl.style.flex = '1';
        nameEl.style.minWidth = '120px';
        nameEl.style.fontWeight = '500';
        nameEl.textContent = s.name || s.id;
        nameEl.title = `${s.id}: ${s.command} ${(s.args || []).join(' ')}`;
        row.appendChild(nameEl);

        const statusEl = document.createElement('span');
        statusEl.style.fontSize = '11px';
        statusEl.style.color = '#888';
        statusEl.textContent = `${statusText} · ${toolCount} 工具`;
        row.appendChild(statusEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary btn-sm';
        editBtn.style.padding = '2px 8px';
        editBtn.textContent = '编辑';
        editBtn.onclick = () => showMcpEditForm(s);
        row.appendChild(editBtn);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-secondary btn-sm';
        toggleBtn.style.padding = '2px 8px';
        toggleBtn.textContent = s.enabled === false ? '启用' : '禁用';
        toggleBtn.onclick = async () => {
            s.enabled = s.enabled === false ? true : false;
            await saveMcpConfig();
        };
        row.appendChild(toggleBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-sm';
        delBtn.style.padding = '2px 8px';
        delBtn.textContent = '✕';
        delBtn.onclick = async () => {
            if (!confirm(`确定删除 "${s.name || s.id}" 吗？`)) return;
            mcpServers.splice(idx, 1);
            await saveMcpConfig();
        };
        row.appendChild(delBtn);

        container.appendChild(row);
    });
}

function showMcpEditForm(server) {
    mcpEditingId = server ? server.id : null;
    document.getElementById('mcp-edit-title').textContent = server ? '编辑 Server' : '添加 Server';

    const idEl = document.getElementById('mcp-edit-id');
    idEl.value = server?.id || '';
    idEl.disabled = !!server;   // 编辑时 id 只读

    document.getElementById('mcp-edit-name').value = server?.name || '';
    document.getElementById('mcp-edit-command').value = server?.command || 'node';
    document.getElementById('mcp-edit-args').value = (server?.args || []).join('\n');
    document.getElementById('mcp-edit-cwd').value = server?.cwd || '';
    document.getElementById('mcp-edit-enabled').checked = server?.enabled !== false;

    document.getElementById('mcp-edit-card').style.display = '';
    const st = document.getElementById('mcp-edit-status');
    st.className = 'status';
}

function hideMcpEditForm() {
    document.getElementById('mcp-edit-card').style.display = 'none';
    mcpEditingId = null;
}

function _collectMcpForm() {
    const id = document.getElementById('mcp-edit-id').value.trim();
    const name = document.getElementById('mcp-edit-name').value.trim();
    const command = document.getElementById('mcp-edit-command').value.trim();
    const argsRaw = document.getElementById('mcp-edit-args').value;
    const cwd = document.getElementById('mcp-edit-cwd').value.trim();
    const enabled = document.getElementById('mcp-edit-enabled').checked;

    const args = argsRaw.split('\n').map(s => s.trim()).filter(Boolean);
    return { id, name, command, args, cwd, enabled };
}

async function saveMcpConfig() {
    await window.electronAPI.saveConfig({ mcp: { servers: mcpServers } });
    const r = await window.electronAPI.mcpReload();
    if (r.success) {
        showStatus('mcp-status', t('status.saved'), 'success');
        await loadMcpTab();
    } else {
        showStatus('mcp-status', t('status.saveFail') + r.error, 'error');
    }
}

document.getElementById('btn-add-mcp-server')?.addEventListener('click', () => {
    showMcpEditForm(null);
});

document.getElementById('btn-reload-mcp')?.addEventListener('click', async () => {
    const r = await window.electronAPI.mcpReload();
    if (r.success) {
        showStatus('mcp-status', '已重新加载', 'success');
        await loadMcpTab();
    } else {
        showStatus('mcp-status', '加载失败：' + r.error, 'error');
    }
});

document.getElementById('btn-mcp-cancel')?.addEventListener('click', hideMcpEditForm);

document.getElementById('btn-mcp-test')?.addEventListener('click', async () => {
    const cfg = _collectMcpForm();
    if (!cfg.command) {
        showStatus('mcp-edit-status', '请填写启动命令', 'error');
        return;
    }
    showStatus('mcp-edit-status', '测试中...', 'info');
    const r = await window.electronAPI.mcpTestServer(cfg);
    if (r.success) {
        showStatus('mcp-edit-status', `✅ 连接成功，发现 ${r.toolCount} 个工具：${r.tools.join(', ')}`, 'success');
    } else {
        showStatus('mcp-edit-status', '❌ 失败：' + r.error, 'error');
    }
});

document.getElementById('btn-mcp-save')?.addEventListener('click', async () => {
    const cfg = _collectMcpForm();

    // 校验
    if (!cfg.id) { showStatus('mcp-edit-status', 'ID 不能为空', 'error'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(cfg.id)) {
        showStatus('mcp-edit-status', 'ID 只能包含字母、数字、- 和 _', 'error');
        return;
    }
    if (!cfg.command) { showStatus('mcp-edit-status', '启动命令不能为空', 'error'); return; }
    if (!cfg.name) cfg.name = cfg.id;

    // 检查 id 冲突
    if (!mcpEditingId) {
        // 添加
        if (mcpServers.some(s => s.id === cfg.id)) {
            showStatus('mcp-edit-status', `ID "${cfg.id}" 已存在`, 'error');
            return;
        }
        mcpServers.push(cfg);
    } else {
        // 编辑
        const idx = mcpServers.findIndex(s => s.id === mcpEditingId);
        if (idx === -1) { showStatus('mcp-edit-status', '找不到原 Server', 'error'); return; }
        mcpServers[idx] = cfg;
    }

    await saveMcpConfig();
    hideMcpEditForm();
});

// Tab 切换到 MCP 时自动加载
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'mcp') {
        btn.addEventListener('click', () => loadMcpTab());
    }
});

// 页面初始化后延迟加载一次（如果当前就在 MCP tab）
setTimeout(() => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'mcp') loadMcpTab();
}, 600);
// ========== 每日简报 ==========
async function loadBriefConfig() {
    try {
        const config = await window.electronAPI.loadConfig();
        const b = config.brief || {};
        const enabledEl = document.getElementById('brief-enabled');
        const mtEl = document.getElementById('brief-morning-time');
        const etEl = document.getElementById('brief-evening-time');
        const cityEl = document.getElementById('brief-city');
        if (!enabledEl) return;
        enabledEl.checked = b.enabled !== false;
        mtEl.value = b.morningTime || '07:30';
        etEl.value = b.eveningTime || '22:00';
        cityEl.value = b.city || '';
    } catch (err) {
        console.warn('[Brief UI] load failed:', err);
    }
}

document.getElementById('btn-save-brief')?.addEventListener('click', async () => {
    const enabled = document.getElementById('brief-enabled').checked;
    const morningTime = document.getElementById('brief-morning-time').value || '07:30';
    const eveningTime = document.getElementById('brief-evening-time').value || '22:00';
    const city = document.getElementById('brief-city').value.trim();
    await window.electronAPI.saveConfig({ brief: { enabled, morningTime, eveningTime, city } });
    showStatus('brief-status', t('status.saved'), 'success');
});

document.getElementById('btn-test-morning')?.addEventListener('click', async () => {
    showStatus('brief-status', '正在触发早报...', 'info');
    const r = await window.electronAPI.briefTrigger('morning');
    if (r.success) showStatus('brief-status', '已触发，看宠物气泡', 'success');
    else showStatus('brief-status', '失败：' + r.error, 'error');
});

document.getElementById('btn-test-evening')?.addEventListener('click', async () => {
    showStatus('brief-status', '正在触发晚报...', 'info');
    const r = await window.electronAPI.briefTrigger('evening');
    if (r.success) showStatus('brief-status', '已触发，看宠物气泡', 'success');
    else showStatus('brief-status', '失败：' + r.error, 'error');
});

document.getElementById('btn-reset-brief')?.addEventListener('click', async () => {
    await window.electronAPI.briefResetState();
    showStatus('brief-status', '已重置，下次到时间会重新触发', 'success');
});

setTimeout(() => loadBriefConfig(), 500);
// ========== 周报 / 月报 ==========

async function loadReportConfig() {
    try {
        const config = await window.electronAPI.loadConfig();
        const r = config.report || {};
        const enabledEl = document.getElementById('report-enabled');
        if (!enabledEl) return;
        enabledEl.checked = r.enabled !== false;
        document.getElementById('report-weekly-time').value = r.weeklyTime || '21:00';
        document.getElementById('report-monthly-time').value = r.monthlyTime || '21:00';
    } catch (err) {
        console.warn('[Report UI] load failed:', err);
    }
}

document.getElementById('btn-save-report')?.addEventListener('click', async () => {
    const enabled = document.getElementById('report-enabled').checked;
    const weeklyTime = document.getElementById('report-weekly-time').value || '21:00';
    const monthlyTime = document.getElementById('report-monthly-time').value || '21:00';
    await window.electronAPI.saveConfig({ report: { enabled, weeklyTime, monthlyTime } });
    showStatus('report-status', t('status.saved'), 'success');
});

document.getElementById('btn-test-weekly')?.addEventListener('click', async () => {
    showStatus('report-status', '正在触发周报...', 'info');
    const r = await window.electronAPI.reportTrigger('weekly');
    if (r.success) showStatus('report-status', '已触发，看宠物气泡', 'success');
    else showStatus('report-status', '失败：' + r.error, 'error');
});

document.getElementById('btn-test-monthly')?.addEventListener('click', async () => {
    showStatus('report-status', '正在触发月报...', 'info');
    const r = await window.electronAPI.reportTrigger('monthly');
    if (r.success) showStatus('report-status', '已触发，看宠物气泡', 'success');
    else showStatus('report-status', '失败：' + r.error, 'error');
});

document.getElementById('btn-reset-report')?.addEventListener('click', async () => {
    await window.electronAPI.reportResetState();
    showStatus('report-status', '已重置，下次到时间会重新触发', 'success');
});

setTimeout(() => loadReportConfig(), 600);

// ========== 云同步 ==========

async function loadCloudConfig() {
    try {
        const config = await window.electronAPI.loadConfig();
        const c = config.cloud || {};
        const enabledEl = document.getElementById('cloud-enabled');
        if (!enabledEl) return;
        enabledEl.checked = c.enabled === true;

        const autoPushEl = document.getElementById('cloud-auto-push');
        if (autoPushEl) autoPushEl.checked = c.autoPush !== false;

        // Provider
        const providerEl = document.getElementById('cloud-provider');
        if (providerEl) providerEl.value = c.provider || 'github-gist';

        // 坚果云字段
        document.getElementById('cloud-webdav-url').value = c.webdavUrl || 'https://dav.jianguoyun.com/dav/';
        document.getElementById('cloud-username').value = c.username || '';
        document.getElementById('cloud-app-password').value = c.appPassword || '';
        document.getElementById('cloud-remote-path').value = c.remotePath || '/Live2DPet';

        // Gist 字段
        document.getElementById('cloud-gist-id').value = c.gistId || '';
        document.getElementById('cloud-github-token').value = c.githubToken || '';
        const syncCharsEl = document.getElementById('cloud-sync-characters');
        if (syncCharsEl) syncCharsEl.checked = c.syncCharacters !== false;

        // 根据 provider 显示对应字段
        applyCloudProviderUI();

        updateLastSyncText(c.lastSyncAt || 0);
    } catch (err) {
        console.warn('[Cloud UI] load failed:', err);
    }

    // 检查未解决冲突
    if (window.electronAPI?.cloudGetUnresolvedConflicts) {
        const uc = await window.electronAPI.cloudGetUnresolvedConflicts();
        if (uc.success && uc.conflicts?.length) {
            const banner = document.getElementById('cloud-action-status');
            if (banner) {
                banner.textContent = `⚠️ 检测到 ${uc.conflicts.length} 个冲突文件（来自自动同步）。点击「上传到云端」处理。`;
                banner.className = 'status error';
            }
        }
    }
}

// 根据 provider 显示对应字段组
function applyCloudProviderUI() {
    const provider = document.getElementById('cloud-provider')?.value || 'github-gist';
    const nutstoreEl = document.getElementById('cloud-fields-nutstore');
    const gistEl = document.getElementById('cloud-fields-gist');
    if (nutstoreEl) nutstoreEl.style.display = provider === 'nutstore' ? '' : 'none';
    if (gistEl) gistEl.style.display = provider === 'github-gist' ? '' : 'none';
}

// 服务商切换时立即更新显示
document.getElementById('cloud-provider')?.addEventListener('change', applyCloudProviderUI);



function updateLastSyncText(ts) {
    const el = document.getElementById('cloud-last-sync');
    if (!el) return;
    if (!ts) {
        el.textContent = '—';
        return;
    }
    const d = new Date(ts);
    const now = Date.now();
    const minsAgo = Math.round((now - ts) / 60000);
    let agoStr;
    if (minsAgo < 1) agoStr = '刚刚';
    else if (minsAgo < 60) agoStr = `${minsAgo} 分钟前`;
    else if (minsAgo < 1440) agoStr = `${Math.round(minsAgo / 60)} 小时前`;
    else agoStr = `${Math.round(minsAgo / 1440)} 天前`;
    el.textContent = `${d.toLocaleString('zh-CN')}（${agoStr}）`;
}

document.getElementById('btn-cloud-save')?.addEventListener('click', async () => {
    const enabled = document.getElementById('cloud-enabled').checked;
    const provider = document.getElementById('cloud-provider').value;
    const autoPush = document.getElementById('cloud-auto-push')?.checked ?? true;

    const cloudData = {
        enabled,
        provider,
        autoPush,
        // 坚果云字段（无论 provider 都保存，切换回来时不丢）
        webdavUrl: document.getElementById('cloud-webdav-url').value.trim(),
        username: document.getElementById('cloud-username').value.trim(),
        appPassword: document.getElementById('cloud-app-password').value,
        remotePath: document.getElementById('cloud-remote-path').value.trim() || '/Live2DPet',
        // Gist 字段
        gistId: document.getElementById('cloud-gist-id').value.trim(),
        githubToken: document.getElementById('cloud-github-token').value.trim(),
        syncCharacters: document.getElementById('cloud-sync-characters')?.checked ?? true
    };

    await window.electronAPI.saveConfig({ cloud: cloudData });
    await window.electronAPI.cloudResetClient();
    await window.electronAPI.cloudSetAutoPush(enabled && autoPush);

    showStatus('cloud-config-status', t('status.saved'), 'success');
});

document.getElementById('btn-cloud-test')?.addEventListener('click', async () => {
    showStatus('cloud-config-status', t('status.testing'), 'info');
    const r = await window.electronAPI.cloudTestConnection();
    if (r.success && r.ok) {
        showStatus('cloud-config-status', `✅ 连接成功，远程目录：${r.remotePath}`, 'success');
    } else {
        const err = r.error || (r.ok === false ? '未知错误' : '');
        showStatus('cloud-config-status', '❌ 连接失败：' + err, 'error');
    }
});

document.getElementById('btn-cloud-push')?.addEventListener('click', async () => {
    await cloudSyncWithConflictCheck();
});

document.getElementById('btn-cloud-pull')?.addEventListener('click', async () => {
    if (!confirm('确定从云端下载数据？\n\n（会覆盖本地同名文件，但会先备份到 data/.backup/）')) return;
    showStatus('cloud-action-status', '⏬ 下载中...', 'info');
    const r = await window.electronAPI.cloudPull();
    if (r.success && r.result?.ok) {
        const files = (r.result.downloaded || []).join('、');
        showStatus('cloud-action-status', `✅ 下载成功：${files}\n重启程序后生效`, 'success');
        updateLastSyncText(r.result.at);
        await loadCloudConfig();
    } else {
        const err = r.error || (r.result?.failed?.length ? `失败文件：${r.result.failed.map(f => f.filename).join('、')}` : '未知错误');
        showStatus('cloud-action-status', '❌ 下载失败：' + err, 'error');
    }
});

// Tab 切换到 cloud 时自动加载
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'cloud') {
        btn.addEventListener('click', () => loadCloudConfig());
    }
});

// 初始化后延迟加载一次
setTimeout(() => {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'cloud') loadCloudConfig();
}, 700);


// ========== 云同步：冲突检测与弹窗 ==========

async function cloudSyncWithConflictCheck() {
    const analysis = await window.electronAPI.cloudAnalyzeConflicts();
    if (!analysis.success) {
        showStatus('cloud-action-status', '❌ 冲突分析失败：' + analysis.error, 'error');
        return;
    }

    const conflicts = analysis.conflicts || [];

    if (conflicts.length === 0) {
        // 无冲突，直接同步
        showStatus('cloud-action-status', '⏫ 同步中...', 'info');
        const sync = await window.electronAPI.cloudSyncWithResolutions({});
        handleSyncResult(sync);
        return;
    }

    // 有冲突 → 弹窗
    showConflictDialog(conflicts);
}

function handleSyncResult(sync) {
    if (sync.success && sync.result?.ok) {
        const parts = [];
        if (sync.result.pushed?.length) parts.push(`上传 ${sync.result.pushed.length} 个`);
        if (sync.result.pulled?.length) parts.push(`下载 ${sync.result.pulled.length} 个`);
        if (sync.result.merged?.length) parts.push(`合并 ${sync.result.merged.length} 个`);
        if (sync.result.skipped?.length) parts.push(`跳过 ${sync.result.skipped.length} 个`);
        const summary = parts.length ? parts.join('，') : '无变更';
        showStatus('cloud-action-status', `✅ 同步完成（${summary}）`, 'success');
        updateLastSyncText(sync.result.at);
        loadCloudConfig();
    } else {
        const err = sync.error
            || (sync.result?.failed?.length
                ? sync.result.failed.map(f => `${f.filename}（${f.error}）`).join('；')
                : '未知错误');
        showStatus('cloud-action-status', '❌ 同步失败：' + err, 'error');
    }
}

function showConflictDialog(conflicts) {
    // 移除可能已存在的旧弹窗
    document.getElementById('cloud-conflict-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'cloud-conflict-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.4); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background:#fff; border-radius:12px; padding:20px;
        max-width:540px; width:90%; max-height:80vh; overflow-y:auto;
        box-shadow:0 8px 24px rgba(0,0,0,0.2);
    `;
    box.innerHTML = `
        <h3 style="font-size:15px;margin-bottom:8px;color:#333;">⚠️ 检测到同步冲突</h3>
        <p style="font-size:12px;color:#666;margin-bottom:14px;">
            以下文件在本机和云端都被修改过。请为每个文件选择保留哪个版本。
        </p>
        <div id="cloud-conflict-list"></div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button id="cloud-conflict-apply" class="btn btn-primary" style="flex:1;">应用选择并同步</button>
            <button id="cloud-conflict-cancel" class="btn btn-secondary" style="flex:1;">取消</button>
        </div>
    `;
    modal.appendChild(box);
    document.body.appendChild(modal);

    const list = box.querySelector('#cloud-conflict-list');
    for (const c of conflicts) {
        const row = document.createElement('div');
        row.style.cssText = 'border:1px solid #eee;border-radius:8px;padding:10px;margin-bottom:8px;';

        const localTime = new Date(c.localMtime).toLocaleString('zh-CN');
        const remoteTime = new Date(c.remoteMtime).toLocaleString('zh-CN');
        const nameMap = {
            'todos.json': '待办',
            'schedules.json': '日程',
            'reminders.json': '提醒',
            'flashcards.json': '复习卡片',
            'chat-memory.json': '对话记忆',
            'companion.json': '陪伴天数',
            'daily-brief.json': '简报状态',
            'report-state.json': '报告状态'
        };
        const displayName = nameMap[c.filename] || c.filename;

        row.innerHTML = `
            <div style="font-weight:500;margin-bottom:6px;font-size:13px;">
                ${displayName} <span style="color:#999;font-weight:normal;font-size:11px;">（${c.filename}）</span>
            </div>
            <div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.5;">
                本地修改：${localTime}<br>
                云端修改：${remoteTime}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;">
                <label style="cursor:pointer;"><input type="radio" name="conf-${c.filename}" value="local" checked> 保留本地</label>
                <label style="cursor:pointer;"><input type="radio" name="conf-${c.filename}" value="remote"> 保留云端</label>
                <label style="cursor:pointer;"><input type="radio" name="conf-${c.filename}" value="merge"> 合并（按 id）</label>
            </div>
        `;
        list.appendChild(row);
    }

    box.querySelector('#cloud-conflict-cancel').onclick = () => modal.remove();
    box.querySelector('#cloud-conflict-apply').onclick = async () => {
        const resolutions = {};
        for (const c of conflicts) {
            const checked = modal.querySelector(`input[name="conf-${c.filename}"]:checked`);
            resolutions[c.filename] = checked?.value || 'local';
        }
        modal.remove();

        showStatus('cloud-action-status', '⏫ 按选择同步中...', 'info');
        const sync = await window.electronAPI.cloudSyncWithResolutions(resolutions);
        handleSyncResult(sync);
    };
}

// 打开 Cloud Tab 时检查未解决冲突
async function checkUnresolvedConflicts() {
    try {
        const r = await window.electronAPI.cloudGetUnresolvedConflicts();
        if (r.success && r.conflicts?.length) {
            // 有未解决的冲突，自动弹窗
            showConflictDialog(r.conflicts);
        }
    } catch {}
}

// 重置同步状态
document.getElementById('btn-cloud-reset-state')?.addEventListener('click', async () => {
    if (!confirm('确定重置同步状态吗？\n\n这会清空"上次同步时间"记录，下次同步时所有文件都当作首次处理，不会误报冲突。')) return;
    const r = await window.electronAPI.cloudResetSyncState();
    if (r.success) {
        showStatus('cloud-action-status', '✅ 已重置，请再次点击「上传到云端」', 'success');
        // 刷新 UI 上的冲突提示
        const banner = document.getElementById('cloud-action-status');
        await loadCloudConfig();
    } else {
        showStatus('cloud-action-status', '❌ 重置失败：' + r.error, 'error');
    }
});