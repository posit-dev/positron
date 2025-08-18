# Phase 3: Kernel Lifecycle Management - Positron Notebook Model
## Timeline: Weeks 8-9

## Executive Summary
Implement comprehensive kernel lifecycle management including startup, shutdown, restart, switching, and error recovery. This phase ensures robust session management and graceful handling of kernel state transitions, crashes, and network interruptions.

## Prerequisites
- Phase 2 (Execution Service Bridge) completed
- Understanding of INotebookKernelService
- IRuntimeSessionService lifecycle methods
- Runtime state machine knowledge

## Background Context

### Kernel vs Runtime Session
In Positron's architecture:
- **Kernel**: UI concept users interact with (Python 3.9, R 4.2, etc.)
- **Runtime Session**: Actual execution environment
- **Bridge**: Maps kernel selections to runtime sessions

### Critical State Transitions
1. **Startup**: Cold start, warm start, reconnection
2. **Execution**: Idle → Busy → Idle
3. **Restart**: Soft restart, hard restart
4. **Shutdown**: Graceful, forced, crash recovery
5. **Switch**: Change language/version mid-session

## Implementation Tasks

### Task 1: Kernel Manager Core
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/kernel/positronNotebookKernelManager.ts`

```typescript
export interface IPositronNotebookKernelManager {
    // Session management
    startKernel(notebookUri: URI, kernelId?: string): Promise<void>;
    restartKernel(notebookUri: URI, clearOutputs?: boolean): Promise<void>;
    switchKernel(notebookUri: URI, newKernelId: string): Promise<void>;
    shutdownKernel(notebookUri: URI): Promise<void>;
    
    // State queries
    getKernelStatus(notebookUri: URI): KernelStatus;
    getActiveSession(notebookUri: URI): ILanguageRuntimeSession | undefined;
    isKernelReady(notebookUri: URI): boolean;
    
    // Events
    readonly onDidChangeKernelStatus: Event<{ uri: URI; status: KernelStatus }>;
    readonly onDidStartKernel: Event<{ uri: URI; kernelId: string }>;
    readonly onDidRestartKernel: Event<{ uri: URI }>;
    readonly onDidShutdownKernel: Event<{ uri: URI }>;
}

export enum KernelStatus {
    Disconnected = 'disconnected',
    Starting = 'starting',
    Idle = 'idle',
    Busy = 'busy',
    Restarting = 'restarting',
    Dead = 'dead',
    Unknown = 'unknown'
}

@registerSingleton(IPositronNotebookKernelManager, PositronNotebookKernelManager)
export class PositronNotebookKernelManager extends Disposable implements IPositronNotebookKernelManager {
    private readonly _sessions = new Map<string, SessionContext>();
    private readonly _stateManager: KernelStateManager;
    private readonly _reconnectManager: ReconnectManager;
    
    private readonly _onDidChangeKernelStatus = this._register(new Emitter<{ uri: URI; status: KernelStatus }>());
    readonly onDidChangeKernelStatus = this._onDidChangeKernelStatus.event;
    
    private readonly _onDidStartKernel = this._register(new Emitter<{ uri: URI; kernelId: string }>());
    readonly onDidStartKernel = this._onDidStartKernel.event;
    
    private readonly _onDidRestartKernel = this._register(new Emitter<{ uri: URI }>());
    readonly onDidRestartKernel = this._onDidRestartKernel.event;
    
    private readonly _onDidShutdownKernel = this._register(new Emitter<{ uri: URI }>());
    readonly onDidShutdownKernel = this._onDidShutdownKernel.event;
    
    constructor(
        @IRuntimeSessionService private readonly runtimeService: IRuntimeSessionService,
        @INotebookKernelService private readonly kernelService: INotebookKernelService,
        @INotificationService private readonly notificationService: INotificationService,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService
    ) {
        super();
        
        this._stateManager = this._register(new KernelStateManager());
        this._reconnectManager = this._register(new ReconnectManager(this.runtimeService));
        
        this._registerListeners();
    }
    
    async startKernel(notebookUri: URI, kernelId?: string): Promise<void> {
        const key = notebookUri.toString();
        
        // Check for existing session
        const existing = this._sessions.get(key);
        if (existing?.session && existing.session.state !== RuntimeSessionState.Exited) {
            this.logService.info(`Kernel already running for ${notebookUri}`);
            return;
        }
        
        try {
            // Update status
            this._updateStatus(notebookUri, KernelStatus.Starting);
            
            // Get kernel selection
            const kernel = kernelId 
                ? this.kernelService.getKernel(kernelId)
                : this.kernelService.getSelectedOrSuggestedKernel(notebookUri);
                
            if (!kernel) {
                throw new Error('No kernel available');
            }
            
            // Map to runtime
            const runtimeId = this._mapKernelToRuntimeId(kernel);
            const sessionName = this._generateSessionName(notebookUri);
            
            // Start session with retry logic
            const sessionId = await this._startSessionWithRetry(
                runtimeId,
                sessionName,
                notebookUri
            );
            
            const session = this.runtimeService.getSession(sessionId);
            if (!session) {
                throw new Error('Failed to create session');
            }
            
            // Store context
            const context: SessionContext = {
                notebookUri,
                session,
                kernelId: kernel.id,
                startTime: Date.now(),
                restartCount: 0,
                status: KernelStatus.Starting
            };
            
            this._sessions.set(key, context);
            
            // Set up session listeners
            this._setupSessionListeners(session, notebookUri);
            
            // Wait for ready state
            await this._waitForReady(session);
            
            // Update status
            this._updateStatus(notebookUri, KernelStatus.Idle);
            
            // Emit event
            this._onDidStartKernel.fire({ uri: notebookUri, kernelId: kernel.id });
            
        } catch (error) {
            this.logService.error(`Failed to start kernel for ${notebookUri}:`, error);
            this._updateStatus(notebookUri, KernelStatus.Dead);
            
            // Show user notification
            this.notificationService.error(
                `Failed to start kernel: ${error.message}`,
                [{
                    label: 'Retry',
                    run: () => this.startKernel(notebookUri, kernelId)
                }]
            );
            
            throw error;
        }
    }
    
    async restartKernel(notebookUri: URI, clearOutputs = true): Promise<void> {
        const context = this._sessions.get(notebookUri.toString());
        if (!context?.session) {
            throw new Error('No kernel session to restart');
        }
        
        try {
            // Update status
            this._updateStatus(notebookUri, KernelStatus.Restarting);
            
            // Increment restart count
            context.restartCount++;
            
            // Check for restart loop
            if (context.restartCount > 5) {
                const timeSinceStart = Date.now() - context.startTime;
                if (timeSinceStart < 60000) { // 5 restarts in 1 minute
                    throw new Error('Kernel restart loop detected');
                }
            }
            
            // Perform restart based on configuration
            const hardRestart = this.configService.getValue('positron.notebook.kernel.hardRestart');
            
            if (hardRestart) {
                // Hard restart: shutdown and start new session
                await this._hardRestart(context, notebookUri);
            } else {
                // Soft restart: restart existing session
                await this._softRestart(context.session);
            }
            
            // Wait for ready
            await this._waitForReady(context.session);
            
            // Update status
            this._updateStatus(notebookUri, KernelStatus.Idle);
            
            // Clear outputs if requested
            if (clearOutputs) {
                // This would be handled by the notebook model
                this._requestClearOutputs(notebookUri);
            }
            
            // Emit event
            this._onDidRestartKernel.fire({ uri: notebookUri });
            
        } catch (error) {
            this.logService.error(`Failed to restart kernel for ${notebookUri}:`, error);
            this._updateStatus(notebookUri, KernelStatus.Dead);
            
            // Offer recovery options
            this._offerRecoveryOptions(notebookUri, error);
            
            throw error;
        }
    }
    
    async switchKernel(notebookUri: URI, newKernelId: string): Promise<void> {
        // Shutdown existing kernel
        const existingContext = this._sessions.get(notebookUri.toString());
        if (existingContext?.session) {
            await this.shutdownKernel(notebookUri);
        }
        
        // Start new kernel
        await this.startKernel(notebookUri, newKernelId);
        
        // Optionally re-run setup cells
        if (this.configService.getValue('positron.notebook.kernel.runSetupOnSwitch')) {
            await this._runSetupCells(notebookUri);
        }
    }
    
    async shutdownKernel(notebookUri: URI): Promise<void> {
        const key = notebookUri.toString();
        const context = this._sessions.get(key);
        
        if (!context?.session) {
            return; // Already shutdown
        }
        
        try {
            // Update status
            this._updateStatus(notebookUri, KernelStatus.Disconnected);
            
            // Shutdown session
            await context.session.shutdown();
            
            // Clean up
            this._sessions.delete(key);
            
            // Emit event
            this._onDidShutdownKernel.fire({ uri: notebookUri });
            
        } catch (error) {
            this.logService.error(`Error shutting down kernel for ${notebookUri}:`, error);
            
            // Force cleanup
            this._sessions.delete(key);
        }
    }
    
    private async _softRestart(session: ILanguageRuntimeSession): Promise<void> {
        // Use runtime service restart method
        await session.restart();
    }
    
    private async _hardRestart(context: SessionContext, notebookUri: URI): Promise<void> {
        // Shutdown existing session
        try {
            await context.session.shutdown();
        } catch (error) {
            this.logService.warn('Error during shutdown for restart:', error);
        }
        
        // Start new session
        const sessionId = await this._startSessionWithRetry(
            context.session.runtimeMetadata.runtimeId,
            context.session.metadata.sessionName,
            notebookUri
        );
        
        const newSession = this.runtimeService.getSession(sessionId);
        if (!newSession) {
            throw new Error('Failed to create new session after restart');
        }
        
        // Update context
        context.session = newSession;
        context.startTime = Date.now();
        
        // Set up listeners
        this._setupSessionListeners(newSession, notebookUri);
    }
    
    private async _startSessionWithRetry(
        runtimeId: string,
        sessionName: string,
        notebookUri: URI,
        maxRetries = 3
    ): Promise<string> {
        let lastError: Error | undefined;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const sessionId = await this.runtimeService.startNewRuntimeSession(
                    runtimeId,
                    sessionName,
                    LanguageRuntimeSessionMode.Notebook,
                    notebookUri,
                    'positron-notebook',
                    RuntimeStartMode.Starting,
                    true // hidden
                );
                
                return sessionId;
                
            } catch (error) {
                lastError = error;
                this.logService.warn(`Session start attempt ${attempt} failed:`, error);
                
                if (attempt < maxRetries) {
                    // Exponential backoff
                    await this._delay(Math.pow(2, attempt) * 1000);
                }
            }
        }
        
        throw lastError || new Error('Failed to start session after retries');
    }
    
    private _setupSessionListeners(session: ILanguageRuntimeSession, notebookUri: URI): void {
        // Listen for state changes
        session.onDidChangeRuntimeState((state) => {
            this._handleStateChange(notebookUri, state);
        });
        
        // Listen for crashes
        session.onDidEncounterError((error) => {
            this._handleSessionError(notebookUri, error);
        });
        
        // Listen for exit
        session.onDidEndSession(() => {
            this._handleSessionEnd(notebookUri);
        });
    }
    
    private _handleStateChange(notebookUri: URI, state: RuntimeSessionState): void {
        let status: KernelStatus;
        
        switch (state) {
            case RuntimeSessionState.Starting:
                status = KernelStatus.Starting;
                break;
            case RuntimeSessionState.Idle:
                status = KernelStatus.Idle;
                break;
            case RuntimeSessionState.Busy:
                status = KernelStatus.Busy;
                break;
            case RuntimeSessionState.Restarting:
                status = KernelStatus.Restarting;
                break;
            case RuntimeSessionState.Exited:
                status = KernelStatus.Dead;
                break;
            default:
                status = KernelStatus.Unknown;
        }
        
        this._updateStatus(notebookUri, status);
    }
    
    private _handleSessionError(notebookUri: URI, error: any): void {
        this.logService.error(`Kernel error for ${notebookUri}:`, error);
        
        // Check if recoverable
        if (this._isRecoverableError(error)) {
            // Attempt auto-recovery
            this._attemptRecovery(notebookUri);
        } else {
            // Mark as dead
            this._updateStatus(notebookUri, KernelStatus.Dead);
            
            // Notify user
            this.notificationService.error(
                `Kernel crashed: ${error.message}`,
                [{
                    label: 'Restart Kernel',
                    run: () => this.restartKernel(notebookUri)
                }]
            );
        }
    }
    
    private _handleSessionEnd(notebookUri: URI): void {
        const context = this._sessions.get(notebookUri.toString());
        if (!context) return;
        
        // Check if intentional shutdown
        if (context.status === KernelStatus.Disconnected) {
            return; // Expected
        }
        
        // Unexpected exit
        this._updateStatus(notebookUri, KernelStatus.Dead);
        
        // Attempt reconnection if configured
        if (this.configService.getValue('positron.notebook.kernel.autoReconnect')) {
            this._reconnectManager.scheduleReconnect(notebookUri, () => {
                return this.startKernel(notebookUri, context.kernelId);
            });
        }
    }
    
    private _isRecoverableError(error: any): boolean {
        // Network errors, temporary failures
        const recoverablePatterns = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENETUNREACH',
            'memory pressure'
        ];
        
        const errorMessage = error.message || error.toString();
        return recoverablePatterns.some(pattern => 
            errorMessage.includes(pattern)
        );
    }
    
    private async _attemptRecovery(notebookUri: URI): Promise<void> {
        const context = this._sessions.get(notebookUri.toString());
        if (!context) return;
        
        // Limit recovery attempts
        context.recoveryAttempts = (context.recoveryAttempts || 0) + 1;
        
        if (context.recoveryAttempts > 3) {
            this.logService.error('Max recovery attempts exceeded');
            this._updateStatus(notebookUri, KernelStatus.Dead);
            return;
        }
        
        try {
            // Wait briefly
            await this._delay(2000);
            
            // Attempt restart
            await this.restartKernel(notebookUri, false);
            
            // Reset counter on success
            context.recoveryAttempts = 0;
            
        } catch (error) {
            this.logService.error('Recovery failed:', error);
        }
    }
    
    private _updateStatus(notebookUri: URI, status: KernelStatus): void {
        const context = this._sessions.get(notebookUri.toString());
        if (context) {
            context.status = status;
        }
        
        this._onDidChangeKernelStatus.fire({ uri: notebookUri, status });
    }
    
    private async _waitForReady(session: ILanguageRuntimeSession, timeoutMs = 30000): Promise<void> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeoutMs) {
            if (session.state === RuntimeSessionState.Idle) {
                return;
            }
            
            if (session.state === RuntimeSessionState.Exited) {
                throw new Error('Session exited while waiting for ready');
            }
            
            await this._delay(100);
        }
        
        throw new Error('Timeout waiting for kernel to be ready');
    }
    
    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

### Task 2: Reconnect Manager
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/kernel/reconnectManager.ts`

```typescript
export class ReconnectManager extends Disposable {
    private readonly _reconnectAttempts = new Map<string, ReconnectContext>();
    private readonly _maxAttempts = 5;
    private readonly _baseDelay = 1000; // 1 second
    
    constructor(
        private readonly runtimeService: IRuntimeSessionService
    ) {
        super();
    }
    
    async scheduleReconnect(
        notebookUri: URI,
        reconnectFn: () => Promise<void>
    ): Promise<void> {
        const key = notebookUri.toString();
        
        let context = this._reconnectAttempts.get(key);
        if (!context) {
            context = {
                attempts: 0,
                lastAttempt: 0,
                timer: undefined
            };
            this._reconnectAttempts.set(key, context);
        }
        
        // Check if max attempts exceeded
        if (context.attempts >= this._maxAttempts) {
            this._reconnectAttempts.delete(key);
            throw new Error('Max reconnection attempts exceeded');
        }
        
        // Calculate delay with exponential backoff
        const delay = this._baseDelay * Math.pow(2, context.attempts);
        
        // Clear existing timer
        if (context.timer) {
            clearTimeout(context.timer);
        }
        
        // Schedule reconnection
        context.timer = setTimeout(async () => {
            context.attempts++;
            context.lastAttempt = Date.now();
            
            try {
                await reconnectFn();
                
                // Success - clean up
                this._reconnectAttempts.delete(key);
                
            } catch (error) {
                // Failed - schedule next attempt
                if (context.attempts < this._maxAttempts) {
                    this.scheduleReconnect(notebookUri, reconnectFn);
                } else {
                    this._reconnectAttempts.delete(key);
                    throw error;
                }
            }
        }, delay);
    }
    
    cancelReconnect(notebookUri: URI): void {
        const key = notebookUri.toString();
        const context = this._reconnectAttempts.get(key);
        
        if (context?.timer) {
            clearTimeout(context.timer);
            this._reconnectAttempts.delete(key);
        }
    }
    
    override dispose(): void {
        // Cancel all pending reconnects
        for (const context of this._reconnectAttempts.values()) {
            if (context.timer) {
                clearTimeout(context.timer);
            }
        }
        
        this._reconnectAttempts.clear();
        super.dispose();
    }
}
```

### Task 3: Kernel State Manager
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/kernel/kernelStateManager.ts`

```typescript
export class KernelStateManager extends Disposable {
    private readonly _states = new Map<string, KernelStateInfo>();
    
    getState(notebookUri: URI): KernelStateInfo {
        const key = notebookUri.toString();
        let state = this._states.get(key);
        
        if (!state) {
            state = {
                status: KernelStatus.Disconnected,
                lastActivity: Date.now(),
                executionCount: 0,
                errorCount: 0,
                metadata: {}
            };
            this._states.set(key, state);
        }
        
        return state;
    }
    
    updateState(notebookUri: URI, update: Partial<KernelStateInfo>): void {
        const state = this.getState(notebookUri);
        Object.assign(state, update);
        state.lastActivity = Date.now();
    }
    
    recordExecution(notebookUri: URI): void {
        const state = this.getState(notebookUri);
        state.executionCount++;
        state.lastActivity = Date.now();
    }
    
    recordError(notebookUri: URI): void {
        const state = this.getState(notebookUri);
        state.errorCount++;
        state.lastActivity = Date.now();
    }
    
    clearState(notebookUri: URI): void {
        this._states.delete(notebookUri.toString());
    }
    
    getIdleTime(notebookUri: URI): number {
        const state = this.getState(notebookUri);
        return Date.now() - state.lastActivity;
    }
    
    getAllStates(): Map<string, KernelStateInfo> {
        return new Map(this._states);
    }
}
```

## Testing Requirements

### Integration Tests
```typescript
suite('PositronNotebookKernelManager - Lifecycle', () => {
    test('starts kernel successfully', async () => {
        const manager = createTestManager();
        const uri = URI.parse('file:///test.ipynb');
        
        await manager.startKernel(uri);
        
        assert.strictEqual(manager.getKernelStatus(uri), KernelStatus.Idle);
        assert.ok(manager.getActiveSession(uri));
    });
    
    test('handles restart correctly', async () => {
        const manager = createTestManager();
        const uri = URI.parse('file:///test.ipynb');
        
        await manager.startKernel(uri);
        const firstSession = manager.getActiveSession(uri);
        
        await manager.restartKernel(uri);
        
        assert.strictEqual(manager.getKernelStatus(uri), KernelStatus.Idle);
        // Session should be same (soft restart) or different (hard restart)
    });
    
    test('switches kernels successfully', async () => {
        const manager = createTestManager();
        const uri = URI.parse('file:///test.ipynb');
        
        await manager.startKernel(uri, 'python3');
        await manager.switchKernel(uri, 'r-4.2');
        
        const session = manager.getActiveSession(uri);
        assert.ok(session?.runtimeMetadata.runtimeId.includes('r'));
    });
    
    test('recovers from crash', async () => {
        const manager = createTestManager();
        const uri = URI.parse('file:///test.ipynb');
        
        await manager.startKernel(uri);
        
        // Simulate crash
        const session = manager.getActiveSession(uri);
        session._simulateCrash();
        
        // Wait for auto-recovery
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        assert.strictEqual(manager.getKernelStatus(uri), KernelStatus.Idle);
    });
    
    test('handles reconnection with backoff', async () => {
        const reconnectManager = new ReconnectManager();
        const uri = URI.parse('file:///test.ipynb');
        
        let attempts = 0;
        const reconnectFn = async () => {
            attempts++;
            if (attempts < 3) {
                throw new Error('Connection failed');
            }
        };
        
        await reconnectManager.scheduleReconnect(uri, reconnectFn);
        
        assert.strictEqual(attempts, 3);
    });
});
```

## Configuration Schema

```json
{
  "positron.notebook.kernel.autoReconnect": {
    "type": "boolean",
    "default": true,
    "description": "Automatically reconnect to kernel after disconnection"
  },
  "positron.notebook.kernel.hardRestart": {
    "type": "boolean",
    "default": false,
    "description": "Use hard restart (new session) instead of soft restart"
  },
  "positron.notebook.kernel.runSetupOnSwitch": {
    "type": "boolean",
    "default": false,
    "description": "Re-run setup cells when switching kernels"
  },
  "positron.notebook.kernel.startupTimeout": {
    "type": "number",
    "default": 30000,
    "description": "Kernel startup timeout in milliseconds"
  }
}
```

## Success Criteria
- ✅ Kernels start reliably with retry logic
- ✅ Restart operations work (soft and hard)
- ✅ Kernel switching preserves notebook state
- ✅ Crash recovery with exponential backoff
- ✅ Network interruption handling
- ✅ State tracking accurate
- ✅ Resource cleanup on shutdown

## Next Phase Dependencies
Provides foundation for:
- Phase 6: UI integration (kernel status display)
- Phase 7: Testing (kernel scenarios)