import * as ch from 'child_process';
import * as fsapi from 'fs-extra';
import * as path from 'path';
import {
    CancellationError,
    CancellationToken,
    Event,
    EventEmitter,
    LogOutputChannel,
    MarkdownString,
    ProgressLocation,
    ThemeIcon,
} from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import {
    DidChangePackagesEventArgs,
    IconPath,
    Package,
    PackageChangeKind,
    PackageManagementOptions,
    PackageManager,
    PythonEnvironment,
    PythonEnvironmentApi,
} from '../../api';
import { showErrorMessage, showInputBox, withProgress } from '../../common/window.apis';
import { PoetryManager } from './poetryManager';
import { getPoetry } from './poetryUtils';

function getChanges(before: Package[], after: Package[]): { kind: PackageChangeKind; pkg: Package }[] {
    const changes: { kind: PackageChangeKind; pkg: Package }[] = [];
    before.forEach((pkg) => {
        changes.push({ kind: PackageChangeKind.remove, pkg });
    });
    after.forEach((pkg) => {
        changes.push({ kind: PackageChangeKind.add, pkg });
    });
    return changes;
}

export class PoetryPackageManager implements PackageManager, Disposable {
    private readonly _onDidChangePackages = new EventEmitter<DidChangePackagesEventArgs>();
    onDidChangePackages: Event<DidChangePackagesEventArgs> = this._onDidChangePackages.event;

    private packages: Map<string, Package[]> = new Map();

    constructor(
        private readonly api: PythonEnvironmentApi,
        public readonly log: LogOutputChannel,
        _poetry: PoetryManager,
    ) {
        this.name = 'poetry';
        this.displayName = 'Poetry';
        this.description = 'This package manager for Python uses Poetry for package management.';
        this.tooltip = new MarkdownString('This package manager for Python uses `poetry` for package management.');
        this.iconPath = new ThemeIcon('package');
    }
    readonly name: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly tooltip?: string | MarkdownString;
    readonly iconPath?: IconPath;

    async manage(environment: PythonEnvironment, options: PackageManagementOptions): Promise<void> {
        let toInstall: string[] = [...(options.install ?? [])];
        let toUninstall: string[] = [...(options.uninstall ?? [])];

        if (toInstall.length === 0 && toUninstall.length === 0) {
            // Show package input UI if no packages are specified
            const installInput = await showInputBox({
                prompt: 'Enter packages to install (comma separated)',
                placeHolder: 'e.g., requests, pytest, black',
            });

            if (installInput) {
                toInstall = installInput
                    .split(',')
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0);
            }

            if (toInstall.length === 0) {
                return;
            }
        }

        await withProgress(
            {
                location: ProgressLocation.Notification,
                title: 'Managing packages with Poetry',
                cancellable: true,
            },
            async (_progress, token) => {
                try {
                    const before = this.packages.get(environment.envId.id) ?? [];
                    const after = await this.managePackages(
                        environment,
                        { install: toInstall, uninstall: toUninstall },
                        token,
                    );
                    const changes = getChanges(before, after);
                    this.packages.set(environment.envId.id, after);
                    this._onDidChangePackages.fire({ environment, manager: this, changes });
                } catch (e) {
                    if (e instanceof CancellationError) {
                        throw e;
                    }
                    this.log.error('Error managing packages with Poetry', e);
                    setImmediate(async () => {
                        const result = await showErrorMessage('Error managing packages with Poetry', 'View Output');
                        if (result === 'View Output') {
                            this.log.show();
                        }
                    });
                    throw e;
                }
            },
        );
    }

    async refresh(environment: PythonEnvironment): Promise<void> {
        await withProgress(
            {
                location: ProgressLocation.Window,
                title: 'Refreshing Poetry packages',
            },
            async () => {
                try {
                    const before = this.packages.get(environment.envId.id) ?? [];
                    const after = await this.refreshPackages(environment);
                    const changes = getChanges(before, after);
                    this.packages.set(environment.envId.id, after);
                    if (changes.length > 0) {
                        this._onDidChangePackages.fire({ environment, manager: this, changes });
                    }
                } catch (error) {
                    this.log.error(`Failed to refresh packages: ${error}`);
                    // Show error to user but don't break the UI
                    setImmediate(async () => {
                        const result = await showErrorMessage('Error refreshing Poetry packages', 'View Output');
                        if (result === 'View Output') {
                            this.log.show();
                        }
                    });
                }
            },
        );
    }

    async getPackages(environment: PythonEnvironment): Promise<Package[] | undefined> {
        if (!this.packages.has(environment.envId.id)) {
            await this.refresh(environment);
        }
        return this.packages.get(environment.envId.id);
    }

    dispose(): void {
        this._onDidChangePackages.dispose();
        this.packages.clear();
    }

    private async managePackages(
        environment: PythonEnvironment,
        options: { install?: string[]; uninstall?: string[] },
        token?: CancellationToken,
    ): Promise<Package[]> {
        // Handle uninstalls first
        if (options.uninstall && options.uninstall.length > 0) {
            try {
                const args = ['remove', ...options.uninstall];
                this.log.info(`Running: poetry ${args.join(' ')}`);
                const result = await runPoetry(args, undefined, this.log, token);
                this.log.info(result);
            } catch (err) {
                this.log.error(`Error removing packages with Poetry: ${err}`);
                throw err;
            }
        }

        // Handle installs
        if (options.install && options.install.length > 0) {
            try {
                const args = ['add', ...options.install];
                this.log.info(`Running: poetry ${args.join(' ')}`);
                const result = await runPoetry(args, undefined, this.log, token);
                this.log.info(result);
            } catch (err) {
                this.log.error(`Error adding packages with Poetry: ${err}`);
                throw err;
            }
        }

        // Refresh the packages list after changes
        return this.refreshPackages(environment);
    }

    private async refreshPackages(environment: PythonEnvironment): Promise<Package[]> {
        let cwd = process.cwd();
        const projects = this.api.getPythonProjects();
        if (projects.length === 1) {
            const stat = await fsapi.stat(projects[0].uri.fsPath);
            if (stat.isDirectory()) {
                cwd = projects[0].uri.fsPath;
            } else {
                cwd = path.dirname(projects[0].uri.fsPath);
            }
        } else if (projects.length > 1) {
            const dirs = new Set<string>();
            await Promise.all(
                projects.map(async (project) => {
                    const e = await this.api.getEnvironment(project.uri);
                    if (e?.envId.id === environment.envId.id) {
                        const stat = await fsapi.stat(projects[0].uri.fsPath);
                        const dir = stat.isDirectory() ? projects[0].uri.fsPath : path.dirname(projects[0].uri.fsPath);
                        if (dirs.has(dir)) {
                            dirs.add(dir);
                        }
                    }
                }),
            );
            if (dirs.size > 0) {
                // ensure we have the deepest directory node picked
                cwd = Array.from(dirs.values()).sort((a, b) => (a.length - b.length) * -1)[0];
            }
        }

        const poetryPackages: { name: string; version: string; displayName: string; description: string }[] = [];

        try {
            this.log.info(`Running: ${await getPoetry()} show --no-ansi`);
            const result = await runPoetry(['show', '--no-ansi'], cwd, this.log);

            // Parse poetry show output
            // Format: name         version    description
            const lines = result.split('\n');
            for (const line of lines) {
                // Updated regex to properly handle lines with the format:
                // "package (!) version description"
                const match = line.match(/^(\S+)(?:\s+\([!]\))?\s+(\S+)\s+(.*)/);
                if (match) {
                    const [, name, version, description] = match;
                    poetryPackages.push({
                        name,
                        version,
                        displayName: name,
                        description: `${version} - ${description?.trim() || ''}`,
                    });
                }
            }
        } catch (err) {
            this.log.error(`Error refreshing packages with Poetry: ${err}`);
            // Return empty array instead of throwing to avoid breaking the UI
            return [];
        }

        // Convert to Package objects using the API
        return poetryPackages.map((pkg) => this.api.createPackageItem(pkg, environment, this));
    }
}

export async function runPoetry(
    args: string[],
    cwd?: string,
    log?: LogOutputChannel,
    token?: CancellationToken,
): Promise<string> {
    const poetry = await getPoetry();
    if (!poetry) {
        throw new Error('Poetry executable not found');
    }

    log?.info(`Running: ${poetry} ${args.join(' ')}`);

    return new Promise<string>((resolve, reject) => {
        const proc = ch.spawn(poetry, args, { cwd });
        token?.onCancellationRequested(() => {
            proc.kill();
            reject(new CancellationError());
        });
        let builder = '';
        proc.stdout?.on('data', (data) => {
            const s = data.toString('utf-8');
            builder += s;
            log?.append(`poetry: ${s}`);
        });
        proc.stderr?.on('data', (data) => {
            const s = data.toString('utf-8');
            builder += s;
            log?.append(`poetry: ${s}`);
        });
        proc.on('close', () => {
            resolve(builder);
        });
        proc.on('error', (error) => {
            log?.error(`Error executing poetry command: ${error}`);
            reject(error);
        });
        proc.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Failed to run poetry ${args.join(' ')}`));
            }
        });
    });
}
