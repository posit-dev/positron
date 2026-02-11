import { Disposable } from 'vscode';
export interface SimpleDebounce extends Disposable {
    trigger(): void;
}

class SimpleDebounceImpl implements SimpleDebounce {
    private timeout: NodeJS.Timeout | undefined;

    constructor(private readonly ms: number, private readonly callback: () => void) {}

    public trigger(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.callback();
        }, this.ms);
    }

    public dispose(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
    }
}

export function createSimpleDebounce(ms: number, callback: () => void): SimpleDebounce {
    return new SimpleDebounceImpl(ms, callback);
}
