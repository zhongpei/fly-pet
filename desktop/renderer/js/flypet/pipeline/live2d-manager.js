if (typeof window !== 'undefined') {
    window.PIXI = window.PIXI;
}
class Live2DManager {
    constructor(canvasId) {
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.modelStartX = 0;
        this.modelStartY = 0;
        this.originalModelBounds = null;
        this.userScale = 1.0;
        this.lipSyncValue = 0;
        this.lipSyncTarget = 0;
        this.lipSyncEnabled = false;
        this.lipSyncParams = [];
        this.baseScale = 1.0;
        this.parameterOverrides = new Map();
        this.modelUpdateCleanup = null;
        this.eyeTrackingEnabled = false;
        this.mouseX = 0;
        this.mouseY = 0;
        this.eyeTrackingTimer = null;
        this.isPlayingMotion = false;
        this.isAnimatingParams = false;
        this.paramMapConfig = null;
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            throw new Error(`Canvas element with id "${canvasId}" not found`);
        }
        this.canvas = canvas;
        this.app = null;
        this.model = null;
        this.currentMotion = null;
        this.currentExpression = null;
        this.initialized = false;
    }
    async destroyCurrentModel() {
        if (!this.model)
            return;
        window.logger?.info('Live2D开始释放模型资源');
        try {
            this.stopLipSync();
            if (this.eyeTrackingTimer) {
                cancelAnimationFrame(this.eyeTrackingTimer);
                this.eyeTrackingTimer = null;
            }
            if (this.modelUpdateCleanup) {
                this.modelUpdateCleanup();
                this.modelUpdateCleanup = null;
            }
            this.parameterOverrides.clear();
            if (this.app && this.model) {
                this.app.stage.removeChild(this.model);
            }
            const internalModel = this.model.internalModel;
            if (internalModel && internalModel.textures) {
                for (const texture of internalModel.textures) {
                    if (texture && typeof texture.destroy === 'function') {
                        texture.destroy(true);
                    }
                }
                window.logger?.debug('Live2D已销毁纹理资源');
            }
            if (typeof this.model.destroy === 'function') {
                this.model.destroy({
                    children: true,
                    texture: true,
                    baseTexture: true
                });
            }
            this.model = null;
            this.currentMotion = null;
            this.currentExpression = null;
            this.originalModelBounds = null;
            this.lipSyncEnabled = false;
            this.isPlayingMotion = false;
            this.paramMapConfig = null;
            window.logger?.info('Live2D模型资源释放完成');
            if (typeof window.gc === 'function') {
                window.gc();
                window.logger?.debug('Live2D已触发垃圾回收');
            }
        }
        catch (error) {
            window.logger?.error('Live2D释放模型资源失败', { error });
        }
    }
    async initialize() {
        try {
            const PIXI = window.PIXI;
            const width = this.canvas.clientWidth || window.innerWidth;
            const height = this.canvas.clientHeight || window.innerHeight;
            const dpr = window.devicePixelRatio || 1;
            this.app = new PIXI.Application({
                view: this.canvas,
                width: width,
                height: height,
                backgroundAlpha: 0,
                resolution: dpr,
                autoDensity: true,
                antialias: true,
                powerPreference: 'high-performance',
                preserveDrawingBuffer: false,
                clearBeforeRender: true,
                sharedTicker: true
            });
            if (navigator.userAgent.includes('Windows')) {
                const ticker = this.app.ticker;
                if (ticker) {
                    ticker.maxFPS = 60;
                    window.logger?.info('Live2D已设置帧率限制', { maxFPS: 60 });
                }
            }
            this.setupResizeHandler();
            window.logger?.info('Live2D初始化成功', { width, height, dpr });
            this.initialized = true;
            return true;
        }
        catch (error) {
            window.logger?.error('Live2D初始化失败', { error });
            return false;
        }
    }
    async loadModel(modelPath) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }
            window.logger?.info('Live2D开始加载模型', { modelPath });
            await this.destroyCurrentModel();
            const Live2DModel = window.PIXI.live2d.Live2DModel;
            const MotionPreloadStrategy = window.PIXI.live2d.MotionPreloadStrategy;
            const live2dModel = await Live2DModel.from(modelPath, {
                autoInteract: false,
                autoUpdate: true,
                motionPreload: MotionPreloadStrategy.IDLE
            });
            this.model = live2dModel;
            this.patchHitAreas(live2dModel);
            this.detectLipSyncParams(live2dModel);
            this.setupParameterOverrideHook(live2dModel);
            this.lipSyncEnabled = true;
            if (this.app) {
                this.app.stage.addChild(live2dModel);
                live2dModel.anchor.set(0.5, 0.5);
                const internalModel = live2dModel.internalModel;
                if (internalModel) {
                    this.originalModelBounds = {
                        width: internalModel.width,
                        height: internalModel.height
                    };
                }
                else {
                    this.originalModelBounds = {
                        width: live2dModel.width,
                        height: live2dModel.height
                    };
                }
                window.logger?.debug('Live2D模型原始尺寸', this.originalModelBounds);
                this.adjustModelTransform();
                this.setupDragging(live2dModel);
                this.setupWheelZoom();
            }
            await this.loadParamMap(modelPath);
            const modelInfo = this.extractModelInfo();
            if (modelInfo) {
                this.sendModelInfoToBackend(modelInfo);
            }
            window.logger?.info('Live2D模型加载成功', { modelPath });
            return true;
        }
        catch (error) {
            window.logger?.error('Live2D模型加载失败', { modelPath, error });
            throw error;
        }
    }
    setupResizeHandler() {
        let resizeTimeout = null;
        window.addEventListener('resize', () => {
            if (resizeTimeout) {
                window.clearTimeout(resizeTimeout);
            }
            resizeTimeout = window.setTimeout(() => {
                window.logger?.debug('Live2D窗口大小变化，调整模型位置');
                this.handleResize();
                resizeTimeout = null;
            }, 100);
        });
    }
    handleResize() {
        if (!this.app || !this.model)
            return;
        const container = this.canvas.parentElement;
        if (!container)
            return;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        window.logger?.debug('Live2D调整窗口尺寸', { width: newWidth, height: newHeight });
        this.canvas.style.width = newWidth + 'px';
        this.canvas.style.height = newHeight + 'px';
        this.app.renderer.resize(newWidth, newHeight);
        this.adjustModelTransform();
    }
    setupDragging(model) {
        const dragThreshold = 3;
        let hasMoved = false;
        model.interactive = true;
        model.eventMode = 'static';
        this.canvas.style.cursor = 'grab';
        this.canvas.addEventListener('mousedown', (event) => {
            if (!this.model)
                return;
            this.isDragging = true;
            hasMoved = false;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            const m = this.model;
            this.modelStartX = m.x;
            this.modelStartY = m.y;
            this.canvas.style.cursor = 'grabbing';
            event.preventDefault();
        });
        window.addEventListener('mousemove', (event) => {
            if (!this.isDragging || !this.model)
                return;
            const deltaX = event.clientX - this.dragStartX;
            const deltaY = event.clientY - this.dragStartY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > dragThreshold) {
                hasMoved = true;
                const m = this.model;
                m.x = this.modelStartX + deltaX;
                m.y = this.modelStartY + deltaY;
            }
        });
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
                if (!hasMoved && this.model) {
                    window.logger?.debug('Live2D模型被点击');
                }
            }
        });
    }
    adjustModelTransform() {
        if (!this.model || !this.app)
            return;
        const model = this.model;
        const container = this.canvas.parentElement;
        if (!container)
            return;
        const canvasWidth = container.clientWidth;
        const canvasHeight = container.clientHeight;
        this.app.renderer.resize(canvasWidth, canvasHeight);
        let modelWidth;
        let modelHeight;
        if (this.originalModelBounds) {
            modelWidth = this.originalModelBounds.width;
            modelHeight = this.originalModelBounds.height;
        }
        else {
            const currentScale = model.scale.x || 1;
            modelWidth = model.width / currentScale;
            modelHeight = model.height / currentScale;
        }
        const targetWidthRatio = 0.75;
        const targetHeightRatio = 0.75;
        const scaleX = (canvasWidth * targetWidthRatio) / modelWidth;
        const scaleY = (canvasHeight * targetHeightRatio) / modelHeight;
        this.baseScale = Math.min(scaleX, scaleY);
        const finalScale = this.baseScale * this.userScale;
        model.scale.set(finalScale);
        model.x = canvasWidth / 2;
        model.y = canvasHeight / 2;
        window.logger?.debug('Live2D模型位置调整', {
            originalSize: this.originalModelBounds,
            baseScale: this.baseScale,
            userScale: this.userScale,
            finalScale,
            position: { x: model.x, y: model.y },
            displaySize: { width: model.width, height: model.height },
            canvas: { width: canvasWidth, height: canvasHeight }
        });
    }
    setupWheelZoom() {
        this.canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            if (!this.model)
                return;
            const delta = -event.deltaY;
            const zoomSpeed = 0.001;
            const zoomDelta = delta * zoomSpeed;
            this.userScale = Math.max(0.3, Math.min(3.0, this.userScale + zoomDelta));
            const model = this.model;
            const finalScale = this.baseScale * this.userScale;
            model.scale.set(finalScale);
            window.logger?.debug('Live2D滚轮缩放', {
                userScale: this.userScale.toFixed(2),
                finalScale: finalScale.toFixed(2)
            });
        }, { passive: false });
    }
    playMotion(motionGroup, motionIndex = 0, _priority = 2) {
        if (!this.model) {
            window.logger?.warn('Live2D模型未加载，无法播放动作');
            return;
        }
        try {
            const model = this.model;
            const FALLBACK_MOTION_GROUP = 'Default';
            const actualGroup = motionGroup === FALLBACK_MOTION_GROUP ? '' : motionGroup;
            if (model.internalModel && model.internalModel.motionManager) {
                this.isPlayingMotion = true;
                const motionPromise = model.motion(actualGroup, motionIndex);
                if (motionPromise && motionPromise.then) {
                    motionPromise.then(() => {
                        this.isPlayingMotion = false;
                    }).catch((error) => {
                        window.logger?.error('Live2D动作播放错误', { motionGroup: actualGroup, motionIndex, error });
                        this.isPlayingMotion = false;
                    });
                }
                else {
                    const MOTION_FALLBACK_DURATION = 2000;
                    setTimeout(() => {
                        this.isPlayingMotion = false;
                    }, MOTION_FALLBACK_DURATION);
                }
                window.logger?.debug('Live2D播放动作', { motionGroup: actualGroup, motionIndex });
                this.currentMotion = `${motionGroup}[${motionIndex}]`;
            }
            else {
                window.logger?.warn('Live2D模型不支持动作播放');
            }
        }
        catch (error) {
            window.logger.error('播放动作失败:', error);
            this.isPlayingMotion = false;
        }
    }
    setExpression(expressionId) {
        if (!this.model) {
            window.logger?.warn('Live2D模型未加载，无法设置表情');
            return;
        }
        try {
            const model = this.model;
            if (model.internalModel && model.internalModel.motionManager) {
                model.expression(expressionId);
                window.logger?.debug('Live2D设置表情', { expressionId });
                this.currentExpression = expressionId;
            }
            else {
                window.logger?.warn('Live2D模型不支持表情设置');
            }
        }
        catch (error) {
            window.logger?.error('Live2D设置表情失败', { expressionId, error });
        }
    }
    lookAt(x, y) {
        if (!this.model)
            return;
        try {
            const model = this.model;
            if (typeof model.focus === 'function') {
                model.focus(x, y);
            }
        }
        catch (error) {
        }
    }
    tap(x, y) {
        if (!this.model)
            return;
        window.logger?.debug('Live2D点击模型', { x, y });
        const model = this.model;
        if (model.internalModel) {
            const hitAreaNames = model.internalModel.hitTest(x, y);
            if (hitAreaNames && hitAreaNames.length > 0) {
                const hitAreaName = hitAreaNames[0];
                window.logger?.debug('Live2D命中区域', { hitAreaName, x, y });
                if (this.isTapEnabled(hitAreaName)) {
                    this.sendTapEventToBackend(hitAreaName, x, y);
                }
                else {
                    window.logger?.debug('Live2D该部位触摸反应未启用', { hitAreaName });
                }
            }
            else {
                if (this.isTapEnabled('default')) {
                    this.sendTapEventToBackend('unknown', x, y);
                }
            }
        }
        else {
            if (this.isTapEnabled('default')) {
                this.sendTapEventToBackend('unknown', x, y);
            }
        }
    }
    async loadParamMap(modelPath) {
        try {
            const lastSlash = modelPath.lastIndexOf('/');
            const modelDir = lastSlash >= 0 ? modelPath.substring(0, lastSlash) : '.';
            const url = `${modelDir}/${Live2DManager.PARAM_MAP_FILENAME}`;
            const response = await fetch(url);
            if (!response.ok) {
                this.paramMapConfig = null;
                window.logger?.debug('[Live2D] 模型目录未提供参数映射表', { path: url });
                return;
            }
            const config = await response.json();
            if (!config || typeof config !== 'object' || config.version !== 1) {
                this.paramMapConfig = null;
                window.logger?.warn('[Live2D] 参数映射表版本不支持，期望 version: 1');
                return;
            }
            this.paramMapConfig = config;
            window.logger?.info('[Live2D] 参数映射表已加载', {
                params: config.parameters?.length ?? 0,
                expressions: config.expressions?.length ?? 0,
                motions: config.motions?.length ?? 0
            });
        }
        catch {
            this.paramMapConfig = null;
        }
    }
    extractModelInfo() {
        if (!this.model)
            return null;
        const model = this.model;
        const internalModel = model.internalModel;
        if (!internalModel) {
            return null;
        }
        const FALLBACK_MOTION_GROUP = 'Default';
        const motions = {};
        if (internalModel.motionManager?.definitions) {
            const definitions = internalModel.motionManager.definitions;
            for (const groupName in definitions) {
                if (definitions.hasOwnProperty(groupName)) {
                    const group = definitions[groupName];
                    const displayName = groupName || FALLBACK_MOTION_GROUP;
                    motions[displayName] = {
                        count: Array.isArray(group) ? group.length : 1,
                        files: Array.isArray(group) ? group.map((m) => m.File || m.file) : [group.File || group.file]
                    };
                }
            }
        }
        const expressions = [];
        if (internalModel.motionManager?.expressionManager?.definitions) {
            const expDefs = internalModel.motionManager.expressionManager.definitions;
            if (Array.isArray(expDefs)) {
                for (const def of expDefs) {
                    if (def && def.Name) {
                        expressions.push(def.Name);
                    }
                }
            }
        }
        const hitAreas = [];
        if (typeof internalModel.getHitAreaDefs === 'function') {
            const defs = internalModel.getHitAreaDefs();
            for (const def of defs) {
                const effectiveName = def.name || def.id || '';
                if (effectiveName && def.index >= 0)
                    hitAreas.push(effectiveName);
            }
        }
        else if (internalModel.hitAreas && typeof internalModel.hitAreas === 'object') {
            for (const key of Object.keys(internalModel.hitAreas)) {
                if (key)
                    hitAreas.push(key);
            }
        }
        const allParams = this.getAvailableParameters();
        const modelInfo = {
            available: true,
            modelPath: window.settingsManager?.getSettings().modelPath || 'unknown',
            dimensions: this.originalModelBounds || { width: 0, height: 0 },
            motions,
            expressions,
            hitAreas,
            availableParameters: allParams,
            parameters: {
                canScale: true,
                currentScale: this.userScale * this.baseScale,
                userScale: this.userScale,
                baseScale: this.baseScale
            }
        };
        if (this.paramMapConfig) {
            this._enrichModelInfoWithParamMap(modelInfo, allParams, expressions, motions);
        }
        return modelInfo;
    }
    _enrichModelInfoWithParamMap(modelInfo, allParams, expressions, motions) {
        const config = this.paramMapConfig;
        if (config.parameters && config.parameters.length > 0) {
            const paramLookup = new Map(allParams.map(p => [p.id, p]));
            const mapped = [];
            for (const entry of config.parameters) {
                const real = paramLookup.get(entry.id);
                if (real) {
                    mapped.push({
                        id: entry.id,
                        alias: entry.alias,
                        description: entry.description,
                        min: real.min,
                        max: real.max,
                        default: real.default
                    });
                }
                else {
                    window.logger?.warn('[Live2D] 参数映射表引用了不存在的参数', { id: entry.id });
                }
            }
            if (mapped.length > 0) {
                modelInfo.mappedParameters = mapped;
            }
        }
        if (config.expressions && config.expressions.length > 0) {
            const validExps = new Set(expressions);
            const mapped = [];
            for (const entry of config.expressions) {
                if (validExps.has(entry.id)) {
                    mapped.push({ id: entry.id, alias: entry.alias, description: entry.description });
                }
                else {
                    window.logger?.warn('[Live2D] 参数映射表引用了不存在的表情', { id: entry.id });
                }
            }
            if (mapped.length > 0) {
                modelInfo.mappedExpressions = mapped;
            }
        }
        if (config.motions && config.motions.length > 0) {
            const mapped = [];
            for (const entry of config.motions) {
                const motionGroup = motions[entry.group];
                if (!motionGroup) {
                    window.logger?.warn('[Live2D] 参数映射表引用了不存在的动作组', { group: entry.group });
                    continue;
                }
                if (entry.index < 0 || entry.index >= motionGroup.count) {
                    window.logger?.warn('[Live2D] 参数映射表引用了不存在的动作索引', { group: entry.group, index: entry.index, count: motionGroup.count });
                    continue;
                }
                mapped.push({
                    group: entry.group,
                    index: entry.index,
                    alias: entry.alias,
                    description: entry.description
                });
            }
            if (mapped.length > 0) {
                modelInfo.mappedMotions = mapped;
            }
        }
    }
    sendModelInfoToBackend(modelInfo) {
        if (!modelInfo || !modelInfo.available) {
            window.logger?.warn('Live2D模型信息不可用，跳过发送');
            return;
        }
        window.logger?.info('Live2D发送模型信息到后端', { modelPath: modelInfo.modelPath });
        if (window.backendClient) {
            window.backendClient.sendMessage({
                type: 'model_info',
                data: modelInfo
            }).catch(err => {
                window.logger?.error('Live2D发送模型信息失败', { error: err });
            });
        }
    }
    isTapEnabled(hitAreaName) {
        const config = this.loadTapConfig();
        if (config[hitAreaName] !== undefined) {
            return config[hitAreaName].enabled === true;
        }
        return config['default']?.enabled !== false;
    }
    loadTapConfig() {
        if (window.settingsManager) {
            return window.settingsManager.getCurrentTapConfig();
        }
        return {
            'default': { enabled: true, description: '默认触摸' }
        };
    }
    sendTapEventToBackend(hitAreaName, x, y) {
        if (!window.backendClient)
            return;
        window.backendClient.sendMessage({
            type: 'tap_event',
            data: {
                hitArea: hitAreaName,
                position: { x, y },
                timestamp: Date.now()
            }
        }).catch(err => {
            window.logger?.error('Live2D发送触碰事件失败', { hitAreaName, error: err });
        });
    }
    async executeSyncCommand(command) {
        window.logger?.info('Live2D执行同步指令', { actions: command.actions?.length });
        if (!command || !command.actions) {
            window.logger?.warn('Live2D同步指令格式错误');
            return;
        }
        for (const action of command.actions) {
            await this.executeAction(action);
            if (action.waitComplete && action.duration) {
                await new Promise(resolve => setTimeout(resolve, action.duration));
            }
        }
    }
    async executeAction(action) {
        switch (action.type) {
            case 'motion':
                if (action.group !== undefined) {
                    this.playMotion(action.group, action.index || 0, action.priority || 2);
                }
                break;
            case 'expression':
                if (action.expressionId) {
                    this.setExpression(action.expressionId);
                }
                break;
            case 'dialogue':
                if (window.dialogueManager && action.text) {
                    window.dialogueManager.showDialogue(action.text, action.duration || 5000);
                }
                break;
            case 'parameter':
                if (action.parameters && action.parameters.length > 0) {
                    this.setParameters(action.parameters);
                }
                else if (action.parameterId !== undefined && action.value !== undefined) {
                    this.setParameter(action.parameterId, action.value, action.weight ?? 1.0, action.duration ?? 0);
                }
                break;
            default:
                window.logger?.warn('Live2D未知动作类型', { type: action.type });
        }
    }
    enableEyeTracking(enabled) {
        this.eyeTrackingEnabled = enabled;
        if (enabled) {
            if (!this.eyeTrackingTimer) {
                this.updateEyeTracking();
            }
        }
        else {
            if (this.eyeTrackingTimer) {
                cancelAnimationFrame(this.eyeTrackingTimer);
                this.eyeTrackingTimer = null;
            }
            if (this.model) {
                const model = this.model;
                const focusController = model.internalModel?.focusController;
                if (focusController && typeof focusController.focus === 'function') {
                    focusController.focus(0, 0, true);
                }
            }
        }
    }
    async updateEyeTracking() {
        if (!this.eyeTrackingEnabled)
            return;
        try {
            if (!this.isPlayingMotion && !this.isAnimatingParams) {
                const cursorPos = await window.electronAPI.getCursorScreenPoint();
                const windowPos = await window.electronAPI.getWindowPosition();
                const rect = this.canvas.getBoundingClientRect();
                this.mouseX = cursorPos.x - windowPos.x - rect.left;
                this.mouseY = cursorPos.y - windowPos.y - rect.top;
                this.lookAt(this.mouseX, this.mouseY);
            }
        }
        catch (error) {
            window.logger?.error('Live2D更新视线跟随失败', { error });
        }
        if (this.eyeTrackingEnabled) {
            this.eyeTrackingTimer = requestAnimationFrame(() => this.updateEyeTracking());
        }
    }
    isEyeTrackingEnabled() {
        return this.eyeTrackingEnabled;
    }
    setParameter(parameterId, value, weight = 1.0, duration = 0) {
        if (!this.model) {
            window.logger.warn('[Live2D] 模型未加载，无法设置参数');
            return;
        }
        this.isAnimatingParams = true;
        const existing = this.parameterOverrides.get(parameterId);
        let startValue;
        if (existing) {
            startValue = this._calculateCurrentOverrideValue(existing);
        }
        else {
            startValue = this._getModelParameterValue(parameterId) ?? value;
        }
        let transitionDuration;
        if (duration > 0) {
            transitionDuration = duration;
        }
        else {
            transitionDuration = this._computeTransitionDuration(parameterId, startValue, value);
        }
        const now = Date.now();
        this.parameterOverrides.set(parameterId, {
            targetValue: value,
            startValue,
            weight,
            startTime: now,
            duration: transitionDuration,
            holdUntil: now + transitionDuration + Live2DManager.HOLD_AFTER_TRANSITION_MS,
            releaseEnd: now + transitionDuration + Live2DManager.HOLD_AFTER_TRANSITION_MS + Live2DManager.RELEASE_DURATION_MS
        });
        window.logger?.debug('[Live2D] 参数缓动已设置', { parameterId, startValue, targetValue: value, weight, duration: transitionDuration });
    }
    setParameters(params) {
        if (!params || params.length === 0)
            return;
        params.forEach(param => {
            this.setParameter(param.id, param.value, param.blend !== undefined ? param.blend : 1.0, param.duration !== undefined ? param.duration : 0);
        });
    }
    clearParameterOverrides() {
        this.parameterOverrides.clear();
        this.isAnimatingParams = false;
    }
    setupParameterOverrideHook(live2dModel) {
        if (this.modelUpdateCleanup) {
            this.modelUpdateCleanup();
            this.modelUpdateCleanup = null;
        }
        const internalModel = live2dModel.internalModel;
        if (!internalModel)
            return;
        const handler = () => {
            this.applyParameterOverrides(internalModel);
            this.applyLipSync(internalModel);
        };
        internalModel.on('beforeModelUpdate', handler);
        this.modelUpdateCleanup = () => {
            internalModel.off('beforeModelUpdate', handler);
        };
        window.logger?.info('[Live2D] 参数覆盖钩子已挂载（beforeModelUpdate）');
    }
    applyParameterOverrides(internalModel) {
        if (this.parameterOverrides.size === 0)
            return;
        const coreModel = internalModel?.coreModel;
        if (!coreModel)
            return;
        const now = Date.now();
        const expired = [];
        for (const [paramId, override] of this.parameterOverrides) {
            if (now >= override.releaseEnd) {
                expired.push(paramId);
                continue;
            }
            try {
                const { value, weight } = this._calculateOverrideState(override);
                if (weight > 0.001) {
                    coreModel.setParameterValueById(paramId, value, weight);
                }
            }
            catch {
                expired.push(paramId);
            }
        }
        for (const paramId of expired) {
            this.parameterOverrides.delete(paramId);
        }
        if (this.parameterOverrides.size === 0 && this.isAnimatingParams) {
            this.isAnimatingParams = false;
        }
    }
    _calculateOverrideState(override) {
        const now = Date.now();
        const elapsed = now - override.startTime;
        if (override.duration > 0 && elapsed < override.duration) {
            const t = elapsed / override.duration;
            const eased = Live2DManager._easeInOutCubic(t);
            const value = override.startValue + (override.targetValue - override.startValue) * eased;
            return { value, weight: override.weight };
        }
        if (now < override.holdUntil) {
            return { value: override.targetValue, weight: override.weight };
        }
        const releaseDuration = override.releaseEnd - override.holdUntil;
        if (releaseDuration > 0 && now < override.releaseEnd) {
            const releaseProgress = (now - override.holdUntil) / releaseDuration;
            const eased = Live2DManager._easeInOutCubic(releaseProgress);
            const fadedWeight = override.weight * (1 - eased);
            return { value: override.targetValue, weight: fadedWeight };
        }
        return { value: override.targetValue, weight: 0 };
    }
    _calculateCurrentOverrideValue(override) {
        const now = Date.now();
        const elapsed = now - override.startTime;
        if (override.duration > 0 && elapsed < override.duration) {
            const t = elapsed / override.duration;
            const eased = Live2DManager._easeInOutCubic(t);
            return override.startValue + (override.targetValue - override.startValue) * eased;
        }
        return override.targetValue;
    }
    _computeTransitionDuration(parameterId, startValue, targetValue) {
        const range = this._getParameterRange(parameterId);
        if (range <= 0) {
            return Live2DManager.FALLBACK_AUTO_DURATION_MS;
        }
        const normalizedDelta = Math.min(1, Math.abs(targetValue - startValue) / range);
        const durationRange = Live2DManager.MAX_AUTO_DURATION_MS - Live2DManager.MIN_AUTO_DURATION_MS;
        return Live2DManager.MIN_AUTO_DURATION_MS + normalizedDelta * durationRange;
    }
    _getParameterRange(parameterId) {
        if (!this.model)
            return 0;
        try {
            const model = this.model;
            const coreModel = model.internalModel?.coreModel;
            if (!coreModel)
                return 0;
            const nativeModel = coreModel.getModel ? coreModel.getModel() : coreModel;
            if (!nativeModel?.parameters)
                return 0;
            const index = coreModel.getParameterIndex(parameterId);
            if (index < 0)
                return 0;
            return nativeModel.parameters.maximumValues[index] - nativeModel.parameters.minimumValues[index];
        }
        catch {
            return 0;
        }
    }
    _getModelParameterValue(parameterId) {
        if (!this.model)
            return null;
        try {
            const model = this.model;
            const coreModel = model.internalModel?.coreModel;
            if (!coreModel)
                return null;
            const index = coreModel.getParameterIndex(parameterId);
            if (index < 0)
                return null;
            return coreModel.getParameterValueByIndex(index);
        }
        catch {
            return null;
        }
    }
    static _easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    applyLipSync(internalModel) {
        if (!this.lipSyncEnabled)
            return;
        const coreModel = internalModel?.coreModel;
        if (!coreModel)
            return;
        const LIP_SYNC_ATTACK = 0.6;
        const LIP_SYNC_RELEASE = 0.3;
        const smoothing = this.lipSyncTarget > this.lipSyncValue ? LIP_SYNC_ATTACK : LIP_SYNC_RELEASE;
        this.lipSyncValue += (this.lipSyncTarget - this.lipSyncValue) * smoothing;
        const DEFAULT_LIP_SYNC_PARAM = 'ParamMouthOpenY';
        const params = this.lipSyncParams.length > 0 ? this.lipSyncParams : [DEFAULT_LIP_SYNC_PARAM];
        for (const paramId of params) {
            try {
                coreModel.setParameterValueById(paramId, this.lipSyncValue);
            }
            catch {
            }
        }
    }
    getAvailableParameters() {
        if (!this.model)
            return [];
        try {
            const model = this.model;
            const coreModel = model.internalModel?.coreModel;
            if (!coreModel)
                return [];
            const parameters = [];
            const nativeModel = coreModel.getModel ? coreModel.getModel() : coreModel;
            if (!nativeModel || !nativeModel.parameters) {
                window.logger?.warn('Live2D无法访问模型参数');
                return [];
            }
            const paramCount = nativeModel.parameters.count;
            const paramIds = nativeModel.parameters.ids;
            const paramValues = nativeModel.parameters.values;
            const paramMinValues = nativeModel.parameters.minimumValues;
            const paramMaxValues = nativeModel.parameters.maximumValues;
            const paramDefaultValues = nativeModel.parameters.defaultValues;
            for (let i = 0; i < paramCount; i++) {
                try {
                    parameters.push({
                        id: paramIds[i],
                        value: paramValues[i],
                        min: paramMinValues[i],
                        max: paramMaxValues[i],
                        default: paramDefaultValues[i]
                    });
                }
                catch (paramError) {
                    window.logger?.warn('Live2D无法获取参数', { index: i, error: paramError });
                }
            }
            return parameters;
        }
        catch (error) {
            window.logger?.error('Live2D获取参数列表失败', { error });
            return [];
        }
    }
    patchHitAreas(live2dModel) {
        const internalModel = live2dModel.internalModel;
        if (!internalModel || typeof internalModel.getHitAreaDefs !== 'function')
            return;
        const defs = internalModel.getHitAreaDefs();
        if (!defs || defs.length === 0)
            return;
        const nameSet = new Set(defs.map(d => d.name));
        const hasCollision = nameSet.size < defs.length;
        if (!hasCollision)
            return;
        const usedKeys = new Set();
        const patchedHitAreas = {};
        for (const def of defs) {
            let key = def.name;
            if (!key || usedKeys.has(key)) {
                key = def.id;
            }
            if (key && !usedKeys.has(key)) {
                usedKeys.add(key);
                patchedHitAreas[key] = def;
            }
        }
        internalModel.hitAreas = patchedHitAreas;
        window.logger?.info('Live2D修补hitAreas', {
            original: defs.length,
            patched: Object.keys(patchedHitAreas)
        });
    }
    detectLipSyncParams(live2dModel) {
        this.lipSyncParams = [];
        const internalModel = live2dModel.internalModel;
        if (!internalModel)
            return;
        const groups = internalModel.settings?.json?.Groups;
        if (Array.isArray(groups)) {
            const LIP_SYNC_GROUP_NAME = 'LipSync';
            const lipSyncGroup = groups.find(g => g.Name === LIP_SYNC_GROUP_NAME);
            if (lipSyncGroup && Array.isArray(lipSyncGroup.Ids)) {
                this.lipSyncParams = lipSyncGroup.Ids;
                window.logger?.info('Live2D检测到LipSync参数', { params: this.lipSyncParams });
                return;
            }
        }
        window.logger?.debug('Live2D未找到LipSync参数组，将使用默认参数');
    }
    destroy() {
        if (this.modelUpdateCleanup) {
            this.modelUpdateCleanup();
            this.modelUpdateCleanup = null;
        }
        this.parameterOverrides.clear();
        if (this.app) {
            this.app.destroy(true, { children: true });
            this.app = null;
        }
        this.model = null;
        this.lipSyncEnabled = false;
        this.lipSyncParams = [];
        this.initialized = false;
    }
    setLipSync(value) {
        this.lipSyncTarget = Math.max(0, Math.min(1, value));
    }
    stopLipSync() {
        this.lipSyncTarget = 0;
    }
}
Live2DManager.PARAM_MAP_FILENAME = 'param-map.json';
Live2DManager.HOLD_AFTER_TRANSITION_MS = 2000;
Live2DManager.RELEASE_DURATION_MS = 500;
Live2DManager.MIN_AUTO_DURATION_MS = 200;
Live2DManager.MAX_AUTO_DURATION_MS = 900;
Live2DManager.FALLBACK_AUTO_DURATION_MS = 400;
window.live2dManager = new Live2DManager('live2d-canvas');
export {};
