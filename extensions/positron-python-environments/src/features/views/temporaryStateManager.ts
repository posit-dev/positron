import { Disposable, Event, EventEmitter } from 'vscode';

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Interface for managing temporary state on tree items.
 */
export interface ITemporaryStateManager {
    readonly onDidChangeState: Event<{ itemId: string; stateKey: string }>;
    setState(itemId: string, stateKey: string): void;
    clearState(itemId: string, stateKey: string): void;
    hasState(itemId: string, stateKey: string): boolean;
    updateContextValue(itemId: string, currentContext: string, stateKeys: string[], separator?: string): string;
}

/**
 * Manages temporary state for tree items that auto-clears after a timeout.
 * Useful for visual feedback like showing a checkmark after copying,
 * or highlighting a recently selected environment.
 */
export class TemporaryStateManager implements ITemporaryStateManager, Disposable {
    private activeItems: Map<string, Set<string>> = new Map();
    private timeouts: Map<string, NodeJS.Timeout> = new Map();
    private readonly _onDidChangeState = new EventEmitter<{ itemId: string; stateKey: string }>();

    public readonly onDidChangeState: Event<{ itemId: string; stateKey: string }> = this._onDidChangeState.event;

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    /**
     * Sets a temporary state on an item. After the timeout, the state is automatically cleared.
     */
    public setState(itemId: string, stateKey: string): void {
        const timeoutKey = `${itemId}:${stateKey}`;
        const existingTimeout = this.timeouts.get(timeoutKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        let states = this.activeItems.get(itemId);
        if (!states) {
            states = new Set();
            this.activeItems.set(itemId, states);
        }
        states.add(stateKey);
        this._onDidChangeState.fire({ itemId, stateKey });

        const timeout = setTimeout(() => {
            this.clearState(itemId, stateKey);
        }, this.timeoutMs);

        this.timeouts.set(timeoutKey, timeout);
    }

    /**
     * Clears a specific state from an item.
     */
    public clearState(itemId: string, stateKey: string): void {
        const timeoutKey = `${itemId}:${stateKey}`;
        this.timeouts.delete(timeoutKey);

        const states = this.activeItems.get(itemId);
        if (states) {
            states.delete(stateKey);
            if (states.size === 0) {
                this.activeItems.delete(itemId);
            }
        }
        this._onDidChangeState.fire({ itemId, stateKey });
    }

    /**
     * Checks if an item has a specific state.
     */
    public hasState(itemId: string, stateKey: string): boolean {
        return this.activeItems.get(itemId)?.has(stateKey) ?? false;
    }

    /**
     * Updates a contextValue string by adding or removing state keys based on current state.
     * @param itemId The item ID to check states for
     * @param currentContext The current contextValue string
     * @param stateKeys The state keys to check and update
     * @param separator The separator to use when adding states (default: ';')
     * @returns The updated contextValue string
     */
    public updateContextValue(
        itemId: string,
        currentContext: string,
        stateKeys: string[],
        separator: string = ';',
    ): string {
        let result = currentContext;
        for (const stateKey of stateKeys) {
            const stateWithSeparator = separator + stateKey;
            if (this.hasState(itemId, stateKey)) {
                if (!result.includes(stateKey)) {
                    result = result + stateWithSeparator;
                }
            } else if (result.includes(stateKey)) {
                result = result.replace(stateWithSeparator, '');
            }
        }
        return result;
    }

    public dispose(): void {
        this.timeouts.forEach((timeout) => clearTimeout(timeout));
        this.timeouts.clear();
        this.activeItems.clear();
        this._onDidChangeState.dispose();
    }
}
