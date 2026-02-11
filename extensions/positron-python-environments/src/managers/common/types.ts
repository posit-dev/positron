import { Uri } from 'vscode';

export interface Installable {
    /**
     * The name of the package, requirements, lock files, or step name.
     */
    readonly name: string;

    /**
     * The name of the package, requirements, pyproject.toml or any other project file, etc.
     */
    readonly displayName: string;

    /**
     * Arguments passed to the package manager to install the package.
     *
     * @example
     *  ['debugpy==1.8.7'] for `pip install debugpy==1.8.7`.
     *  ['--pre', 'debugpy'] for `pip install --pre debugpy`.
     *  ['-r', 'requirements.txt'] for `pip install -r requirements.txt`.
     */
    readonly args?: string[];

    /**
     * Installable group name, this will be used to group installable items in the UI.
     *
     * @example
     *  `Requirements` for any requirements file.
     *  `Packages` for any package.
     */
    readonly group?: string;

    /**
     * Description about the installable item. This can also be path to the requirements,
     * version of the package, or any other project file path.
     */
    readonly description?: string;

    /**
     * External Uri to the package on pypi or docs.
     * @example
     *  https://pypi.org/project/debugpy/ for `debugpy`.
     */
    readonly uri?: Uri;
}
export interface IDisposable {
    dispose(): void | undefined | Promise<void>;
}
