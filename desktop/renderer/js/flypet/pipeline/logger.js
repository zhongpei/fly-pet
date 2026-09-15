class Logger {
    constructor() {
        this.enabled = false;
        this.levels = ['warn', 'error', 'critical'];
    }
    async initialize() {
        try {
            const config = await window.electronAPI.loggerGetConfig();
            this.enabled = config.enabled;
            this.levels = config.levels;
            console.log('[Renderer Logger] 日志系统已初始化', config);
        }
        catch (error) {
            console.error('[Renderer Logger] 初始化失败:', error);
        }
    }
    async updateConfig(config) {
        try {
            await window.electronAPI.loggerUpdateConfig(config);
            if (config.enabled !== undefined) {
                this.enabled = config.enabled;
            }
            if (config.levels) {
                this.levels = config.levels;
            }
            console.log('[Renderer Logger] 配置已更新', config);
        }
        catch (error) {
            console.error('[Renderer Logger] 更新配置失败:', error);
        }
    }
    log(level, message, data) {
        if (!this.enabled || !this.levels.includes(level)) {
            return;
        }
        window.electronAPI.loggerLog(level, `[Renderer] ${message}`, data);
        const consoleMethod = level === 'critical' || level === 'error' ? 'error' :
            level === 'warn' ? 'warn' : 'log';
        console[consoleMethod](`[Logger] ${message}`, data || '');
    }
    debug(message, data) {
        this.log('debug', message, data);
    }
    info(message, data) {
        this.log('info', message, data);
    }
    warn(message, data) {
        this.log('warn', message, data);
    }
    error(message, data) {
        this.log('error', message, data);
    }
    critical(message, data) {
        this.log('critical', message, data);
    }
    async getLogFiles() {
        try {
            return await window.electronAPI.loggerGetFiles();
        }
        catch (error) {
            console.error('[Renderer Logger] 获取日志文件列表失败:', error);
            return [];
        }
    }
    async deleteLogFile(fileName) {
        try {
            const result = await window.electronAPI.loggerDeleteFile(fileName);
            return result.success;
        }
        catch (error) {
            console.error('[Renderer Logger] 删除日志文件失败:', error);
            return false;
        }
    }
    async deleteAllLogs() {
        try {
            const result = await window.electronAPI.loggerDeleteAll();
            return result.count;
        }
        catch (error) {
            console.error('[Renderer Logger] 删除所有日志失败:', error);
            return 0;
        }
    }
    async openLogDirectory() {
        try {
            await window.electronAPI.loggerOpenDirectory();
        }
        catch (error) {
            console.error('[Renderer Logger] 打开日志目录失败:', error);
        }
    }
    async getConfig() {
        try {
            return await window.electronAPI.loggerGetConfig();
        }
        catch (error) {
            console.error('[Renderer Logger] 获取配置失败:', error);
            return null;
        }
    }
}
export const logger = new Logger();
window.logger = logger;
