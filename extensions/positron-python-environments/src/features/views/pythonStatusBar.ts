import { Disposable, StatusBarAlignment, StatusBarItem, ThemeColor } from 'vscode';
import { PythonEnvironment } from '../../api';
import { createStatusBarItem } from '../../common/window.apis';

export interface PythonStatusBar extends Disposable {
    show(env?: PythonEnvironment): void;
    hide(): void;
}

export class PythonStatusBarImpl implements Disposable {
    private disposables: Disposable[] = [];
    private readonly statusBarItem: StatusBarItem;
    constructor() {
        this.statusBarItem = createStatusBarItem('python.interpreterDisplay', StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'python-envs.set';
        this.statusBarItem.name = 'Python Interpreter';
        this.statusBarItem.tooltip = 'Select Python Interpreter';
        this.statusBarItem.text = '$(loading~spin)';
        this.statusBarItem.show();
        this.disposables.push(this.statusBarItem);
    }

    public show(env?: PythonEnvironment) {
        if (env) {
            this.statusBarItem.text = env.displayName ?? 'Select Python Interpreter';
            this.statusBarItem.tooltip = env.environmentPath?.fsPath ?? '';
        } else {
            this.statusBarItem.text = 'Select Python Interpreter';
            this.statusBarItem.tooltip = 'Select Python Interpreter';
        }
        this.statusBarItem.backgroundColor = env ? undefined : new ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.show();
    }

    public hide() {
        this.statusBarItem.hide();
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}
