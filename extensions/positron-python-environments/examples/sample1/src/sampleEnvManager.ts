import { MarkdownString, LogOutputChannel, Event } from 'vscode';
import {
    CreateEnvironmentOptions,
    CreateEnvironmentScope,
    DidChangeEnvironmentEventArgs,
    DidChangeEnvironmentsEventArgs,
    EnvironmentManager,
    GetEnvironmentScope,
    GetEnvironmentsScope,
    IconPath,
    PythonEnvironment,
    QuickCreateConfig,
    RefreshEnvironmentsScope,
    ResolveEnvironmentContext,
    SetEnvironmentScope,
} from './api';

export class SampleEnvManager implements EnvironmentManager {
    name: string;
    displayName?: string | undefined;
    preferredPackageManagerId: string;
    description?: string | undefined;
    tooltip?: string | MarkdownString | undefined;
    iconPath?: IconPath | undefined;
    log?: LogOutputChannel | undefined;

    constructor(log: LogOutputChannel) {
        this.name = 'sample';
        this.displayName = 'Sample';
        this.preferredPackageManagerId = 'my-publisher.sample:sample';
        // if you want to use builtin `pip` then use this
        // this.preferredPackageManagerId = 'ms-python.python:pip';
        this.log = log;
    }

    quickCreateConfig(): QuickCreateConfig | undefined {
        // Code to provide quick create configuration goes here

        throw new Error('Method not implemented.');
    }

    create?(scope: CreateEnvironmentScope, options?: CreateEnvironmentOptions): Promise<PythonEnvironment | undefined> {
        // Code to handle creating environments goes here

        throw new Error('Method not implemented.');
    }
    remove?(environment: PythonEnvironment): Promise<void> {
        // Code to handle removing environments goes here

        throw new Error('Method not implemented.');
    }
    refresh(scope: RefreshEnvironmentsScope): Promise<void> {
        // Code to handle refreshing environments goes here
        // This is called when the user clicks on the refresh button in the UI

        throw new Error('Method not implemented.');
    }
    getEnvironments(scope: GetEnvironmentsScope): Promise<PythonEnvironment[]> {
        // Code to get the list of environments goes here
        // This may be called when the python extension is activated to get the list of environments

        throw new Error('Method not implemented.');
    }

    // Event to be raised with the list of available extensions changes for this manager
    onDidChangeEnvironments?: Event<DidChangeEnvironmentsEventArgs> | undefined;

    set(scope: SetEnvironmentScope, environment?: PythonEnvironment): Promise<void> {
        // User selected a environment for the given scope
        // undefined environment means user wants to reset the environment for the given scope

        throw new Error('Method not implemented.');
    }
    get(scope: GetEnvironmentScope): Promise<PythonEnvironment | undefined> {
        // Code to get the environment for the given scope goes here

        throw new Error('Method not implemented.');
    }

    // Event to be raised when the environment for any active scope changes
    onDidChangeEnvironment?: Event<DidChangeEnvironmentEventArgs> | undefined;

    resolve(context: ResolveEnvironmentContext): Promise<PythonEnvironment | undefined> {
        // Code to resolve the environment goes here. Resolving an environment means
        // to convert paths to actual environments

        throw new Error('Method not implemented.');
    }

    clearCache?(): Promise<void> {
        // Code to clear any cached data goes here

        throw new Error('Method not implemented.');
    }
}
