"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const vscode_universal_bundler_1 = require("vscode-universal-bundler");
const cross_spawn_promise_1 = require("@malept/cross-spawn-promise");
const root = path.dirname(path.dirname(__dirname));
async function main(buildDir) {
    const arch = process.env['VSCODE_ARCH'];
    if (!buildDir) {
        throw new Error('Build dir not provided');
    }
    const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
    const appName = product.nameLong + '.app';
    const x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
    const arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
    const x64AsarPath = path.join(x64AppPath, 'Contents', 'Resources', 'app', 'node_modules.asar');
    const arm64AsarPath = path.join(arm64AppPath, 'Contents', 'Resources', 'app', 'node_modules.asar');
    const outAppPath = path.join(buildDir, `VSCode-darwin-${arch}`, appName);
    const productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');
    await (0, vscode_universal_bundler_1.makeUniversalApp)({
        x64AppPath,
        arm64AppPath,
        x64AsarPath,
        arm64AsarPath,
        filesToSkip: [
            'product.json',
            'Credits.rtf',
            'CodeResources',
            'fsevents.node',
            'Info.plist',
            'MainMenu.nib',
            '.npmrc',
            // --- Start Positron ---
            // Exclusions from ZeroMQ node module
            'electron.napi.node',
            'node.napi.node',
            'node.napi.glibc.node',
            // Exclusions from Python language pack (positron-python)
            'pydevd',
            // Exclusions from R language pack (positron-r)
            'amalthea',
            'ark' // Compiled R kernel and LSP
            // --- End Positron ---
        ],
        outAppPath,
        force: true
    });
    const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
    Object.assign(productJson, {
        darwinUniversalAssetId: 'darwin-universal'
    });
    fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t'));
    // Verify if native module architecture is correct
    const findOutput = await (0, cross_spawn_promise_1.spawn)('find', [outAppPath, '-name', 'keytar.node']);
    const lipoOutput = await (0, cross_spawn_promise_1.spawn)('lipo', ['-archs', findOutput.replace(/\n$/, '')]);
    if (lipoOutput.replace(/\n$/, '') !== 'x86_64 arm64') {
        throw new Error(`Invalid arch, got : ${lipoOutput}`);
    }
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLXVuaXZlcnNhbC1hcHAuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjcmVhdGUtdW5pdmVyc2FsLWFwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztnR0FHZ0c7O0FBRWhHLDZCQUE2QjtBQUM3Qix5QkFBeUI7QUFDekIsdUVBQTREO0FBQzVELHFFQUFvRDtBQUVwRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztBQUVuRCxLQUFLLFVBQVUsSUFBSSxDQUFDLFFBQWlCO0lBQ3BDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUM7SUFFeEMsSUFBSSxDQUFDLFFBQVEsRUFBRTtRQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQztLQUMxQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3JGLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDO0lBQzFDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLG1CQUFtQixFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3JFLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLHFCQUFxQixFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3pFLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLG1CQUFtQixDQUFDLENBQUM7SUFDL0YsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztJQUNuRyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDekUsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFFakcsTUFBTSxJQUFBLDJDQUFnQixFQUFDO1FBQ3RCLFVBQVU7UUFDVixZQUFZO1FBQ1osV0FBVztRQUNYLGFBQWE7UUFDYixXQUFXLEVBQUU7WUFDWixjQUFjO1lBQ2QsYUFBYTtZQUNiLGVBQWU7WUFDZixlQUFlO1lBQ2YsWUFBWTtZQUNaLGNBQWM7WUFDZCxRQUFRO1lBQ1IseUJBQXlCO1lBQ3pCLHFDQUFxQztZQUNyQyxvQkFBb0I7WUFDcEIsZ0JBQWdCO1lBQ2hCLHNCQUFzQjtZQUN0Qix5REFBeUQ7WUFDekQsUUFBUTtZQUNSLCtDQUErQztZQUMvQyxVQUFVO1lBQ1YsS0FBSyxDQUFpQiw0QkFBNEI7WUFDbEQsdUJBQXVCO1NBQ3ZCO1FBQ0QsVUFBVTtRQUNWLEtBQUssRUFBRSxJQUFJO0tBQ1gsQ0FBQyxDQUFDO0lBRUgsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLGVBQWUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3pFLE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFO1FBQzFCLHNCQUFzQixFQUFFLGtCQUFrQjtLQUMxQyxDQUFDLENBQUM7SUFDSCxFQUFFLENBQUMsYUFBYSxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUUzRSxrREFBa0Q7SUFDbEQsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFBLDJCQUFLLEVBQUMsTUFBTSxFQUFFLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDO0lBQzdFLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBQSwyQkFBSyxFQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDbEYsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxjQUFjLEVBQUU7UUFDckQsTUFBTSxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsVUFBVSxFQUFFLENBQUMsQ0FBQztLQUNyRDtBQUNGLENBQUM7QUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssTUFBTSxFQUFFO0lBQzVCLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1FBQ2pDLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDbkIsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqQixDQUFDLENBQUMsQ0FBQztDQUNIIn0=