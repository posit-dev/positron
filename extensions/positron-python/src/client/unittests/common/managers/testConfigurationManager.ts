import * as path from 'path';
import { OutputChannel, QuickPickItem, Uri, window } from 'vscode';
import { createDeferred } from '../../../common/helpers';
import { IInstaller, Product } from '../../../common/types';
import { getSubDirectories } from '../../../common/utils';
import { ITestConfigSettingsService, UnitTestProduct } from './../types';

export abstract class TestConfigurationManager {
    constructor(protected workspace: Uri,
        protected product: UnitTestProduct,
        protected readonly outputChannel: OutputChannel,
        protected installer: IInstaller,
        protected testConfigSettingsService: ITestConfigSettingsService) { }
    // tslint:disable-next-line:no-any
    public abstract configure(wkspace: Uri): Promise<any>;
    public async enable() {
        // Disable other test frameworks.
        const testProducsToDisable = [Product.pytest, Product.unittest, Product.nosetest]
            .filter(item => item !== this.product) as UnitTestProduct[];

        for (const prod of testProducsToDisable) {
            await this.testConfigSettingsService.disable(this.workspace, prod);
        }

        return this.testConfigSettingsService.enable(this.workspace, this.product);
    }
    // tslint:disable-next-line:no-any
    public async disable() {
        return this.testConfigSettingsService.enable(this.workspace, this.product);
    }
    protected selectTestDir(rootDir: string, subDirs: string[], customOptions: QuickPickItem[] = []): Promise<string> {
        const options = {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Select the directory containing the unit tests'
        };
        let items: QuickPickItem[] = subDirs
            .map(dir => {
                const dirName = path.relative(rootDir, dir);
                if (dirName.indexOf('.') === 0) {
                    return;
                }
                return {
                    label: dirName,
                    description: ''
                };
            })
            .filter(item => item !== undefined)
            .map(item => item!);

        items = [{ label: '.', description: 'Root directory' }, ...items];
        items = customOptions.concat(items);
        const def = createDeferred<string>();
        window.showQuickPick(items, options).then(item => {
            if (!item) {
                return def.resolve();
            }

            def.resolve(item.label);
        });

        return def.promise;
    }

    protected selectTestFilePattern(): Promise<string> {
        const options = {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Select the pattern to identify test files'
        };
        const items: QuickPickItem[] = [
            { label: '*test.py', description: 'Python Files ending with \'test\'' },
            { label: '*_test.py', description: 'Python Files ending with \'_test\'' },
            { label: 'test*.py', description: 'Python Files begining with \'test\'' },
            { label: 'test_*.py', description: 'Python Files begining with \'test_\'' },
            { label: '*test*.py', description: 'Python Files containing the word \'test\'' }
        ];

        const def = createDeferred<string>();
        window.showQuickPick(items, options).then(item => {
            if (!item) {
                return def.resolve();
            }

            def.resolve(item.label);
        });

        return def.promise;
    }
    protected getTestDirs(rootDir: string): Promise<string[]> {
        return getSubDirectories(rootDir).then(subDirs => {
            subDirs.sort();

            // Find out if there are any dirs with the name test and place them on the top.
            const possibleTestDirs = subDirs.filter(dir => dir.match(/test/i));
            const nonTestDirs = subDirs.filter(dir => possibleTestDirs.indexOf(dir) === -1);
            possibleTestDirs.push(...nonTestDirs);

            // The test dirs are now on top.
            return possibleTestDirs;
        });
    }
}
