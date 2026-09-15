class ResponseController {
    constructor() {
        this.currentSession = null;
        this.discardedIds = new Set();
    }
    shouldAccept(responseId, priority) {
        if (this.currentSession && this.currentSession.responseId === responseId) {
            return true;
        }
        if (this.discardedIds.has(responseId)) {
            return false;
        }
        if (!this.currentSession) {
            this.beginSession(responseId, priority);
            return true;
        }
        if (priority >= this.currentSession.priority) {
            window.logger?.info(`[ResponseController] 中断响应 ${this.currentSession.responseId} (priority=${this.currentSession.priority}) → 新响应 ${responseId} (priority=${priority})`);
            this.interruptCurrent();
            this.beginSession(responseId, priority);
            return true;
        }
        window.logger?.info(`[ResponseController] 丢弃低优先级响应 ${responseId} (priority=${priority}), 当前 ${this.currentSession.responseId} (priority=${this.currentSession.priority})`);
        this.addDiscarded(responseId);
        return false;
    }
    isActive(responseId) {
        if (!responseId)
            return true;
        if (this.discardedIds.has(responseId))
            return false;
        if (this.currentSession && this.currentSession.responseId === responseId)
            return true;
        if (!this.currentSession)
            return true;
        return false;
    }
    markAudioActive() {
        if (this.currentSession) {
            this.currentSession.hasActiveAudio = true;
        }
    }
    notifyComplete(responseId) {
        if (!this.currentSession)
            return;
        if (responseId && this.currentSession.responseId !== responseId)
            return;
        window.logger?.info(`[ResponseController] 响应 ${this.currentSession.responseId} 自然结束`);
        this.currentSession = null;
    }
    getCurrentSession() {
        return this.currentSession;
    }
    interruptCurrent() {
        if (!this.currentSession)
            return;
        const session = this.currentSession;
        if (window.audioPlayer) {
            window.audioPlayer.stop();
        }
        if (window.dialogueManager) {
            window.dialogueManager.hideDialogue();
        }
        this.addDiscarded(session.responseId);
        this.currentSession = null;
    }
    beginSession(responseId, priority) {
        this.currentSession = {
            responseId,
            priority,
            startTime: Date.now(),
            hasActiveAudio: false
        };
    }
    addDiscarded(responseId) {
        this.discardedIds.add(responseId);
        if (this.discardedIds.size > ResponseController.MAX_DISCARDED_CACHE) {
            const iter = this.discardedIds.values();
            this.discardedIds.delete(iter.next().value);
        }
    }
}
ResponseController.MAX_DISCARDED_CACHE = 50;
window.responseController = new ResponseController();
export {};
