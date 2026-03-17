"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
_test_setup_1.test.use({
    suiteId: __filename
});
const OPTIONAL_MISSING_EXTENSIONS = new Set([
    'meta.pyrefly',
]);
_test_setup_1.test.describe('Bootstrap Extensions', {
    tag: [_test_setup_1.tags.EXTENSIONS, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.WORKBENCH, _test_setup_1.tags.CROSS_BROWSER],
}, () => {
    _test_setup_1.test.beforeAll('Skip during main run', async function () {
        if (process.env.SKIP_BOOTSTRAP === 'true') {
            _test_setup_1.test.skip();
        }
    });
    (0, _test_setup_1.test)('Verify All Bootstrap extensions are installed', async function ({ options, runDockerCommand }, testInfo) {
        const extensions = readProductJson();
        const isWorkbench = testInfo.project.name === 'e2e-workbench';
        const containerExtensionsPath = '/home/user1/.positron-server/extensions';
        await waitForExtensions(extensions, isWorkbench ? containerExtensionsPath : options.extensionsPath, isWorkbench ? runDockerCommand : undefined);
    });
});
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function readProductJson() {
    const raw = fs.readFileSync('product.json', 'utf-8');
    const data = JSON.parse(raw);
    return data.bootstrapExtensions.map((ext) => {
        const fullName = ext.name;
        const shortName = fullName.split('.').pop();
        return {
            fullName,
            shortName,
            version: ext.version
        };
    });
}
async function getInstalledExtensions(extensionsDir, runDockerCommand) {
    const installed = new Map();
    // Workbench: read extensions from Docker container
    if (runDockerCommand) {
        try {
            const { stdout } = await runDockerCommand(`docker exec test bash -lc "ls -1 ${extensionsDir} || true"`, 'List extensions in container');
            const dirs = stdout.split('\n').map(s => s.trim()).filter(Boolean);
            for (const extDir of dirs) {
                try {
                    const remotePkgPath = `${extensionsDir}/${extDir}/package.json`;
                    const { stdout: pkgStr } = await runDockerCommand(`docker exec test cat "${remotePkgPath}"`, `Read package.json for ${extDir}`);
                    const pkg = JSON.parse(pkgStr);
                    if (pkg.name && pkg.version) {
                        installed.set(pkg.name, pkg.version);
                    }
                }
                catch {
                    // ignore dirs without package.json or unreadable files
                }
            }
        }
        catch {
            // If listing fails, treat as no installed extensions
        }
        return installed;
    }
    // Default: read from local filesystem
    if (!fs.existsSync(extensionsDir)) {
        return installed;
    }
    for (const extDir of fs.readdirSync(extensionsDir)) {
        const packageJsonPath = path.join(extensionsDir, extDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (pkg.name && pkg.version) {
                installed.set(pkg.name, pkg.version);
            }
        }
    }
    return installed;
}
async function waitForExtensions(extensions, extensionsPath, runDockerCommand, mismatchGraceMs = 60_000) {
    const missing = new Set(extensions.map(ext => ext.fullName));
    const mismatched = new Set();
    // Phase 1: wait for all to be installed (mismatches are noted, but we continue)
    while (missing.size > 0) {
        const installed = await getInstalledExtensions(extensionsPath, runDockerCommand);
        for (const ext of extensions) {
            if (!missing.has(ext.fullName)) {
                continue;
            }
            // Prefer fullName (package name) but fall back to shortName
            const installedVersion = installed.get(ext.fullName) ??
                installed.get(ext.shortName);
            if (!installedVersion) {
                if (OPTIONAL_MISSING_EXTENSIONS.has(ext.fullName)) {
                    console.log(`⚠️ Optional bootstrap extension ${ext.fullName} is not installed; allowing test to continue.`);
                    missing.delete(ext.fullName);
                }
                else {
                    console.log(`❌ ${ext.fullName} not yet installed`);
                }
            }
            else if (installedVersion !== ext.version) {
                console.log(`⚠️  ${ext.fullName} installed with version ${installedVersion}, currently ${ext.version} in product.json`);
                missing.delete(ext.fullName);
                mismatched.add(ext.fullName);
            }
            else {
                console.log(`✅ ${ext.fullName} (${ext.version}) found and matches`);
                missing.delete(ext.fullName);
            }
        }
        if (missing.size > 0) {
            console.log(`⏳ Still waiting on: ${Array.from(missing).join(', ')}`);
            await sleep(1000);
        }
    }
    // Phase 2: give mismatches time to auto-resolve (e.g., post-install updates settling)
    if (mismatched.size > 0) {
        console.log(`\n⏳ Detected mismatches. Allowing up to ${Math.round(mismatchGraceMs / 1000)}s for auto-resolution...`);
        const deadline = Date.now() + mismatchGraceMs;
        while (mismatched.size > 0 && Date.now() < deadline) {
            await sleep(1000);
            const installed = await getInstalledExtensions(extensionsPath, runDockerCommand);
            for (const extFullName of [...mismatched]) {
                const extMeta = extensions.find(e => e.fullName === extFullName);
                const installedVersion = (extMeta && (installed.get(extMeta.fullName) ?? installed.get(extMeta.shortName))) ||
                    undefined;
                const expected = extMeta?.version;
                if (installedVersion && expected && installedVersion === expected) {
                    console.log(`✅ Resolved: ${extFullName} now matches (${installedVersion})`);
                    mismatched.delete(extFullName);
                }
            }
        }
    }
    if (mismatched.size > 0) {
        console.log('\n❌ Some extensions are still mismatched after the grace period:');
        for (const ext of mismatched) {
            console.log(`   * ${ext}`);
        }
        console.log('\n👉 Run script and commit changes:');
        console.log(`   ./scripts/update-extensions.sh ${Array.from(mismatched).join(' ')}\n`);
        if (process.env.EXTENSIONS_FAIL_ON_MISMATCH === 'true') {
            throw new Error('Some extensions were installed with mismatched versions (after grace period). Please check the logs above.');
        }
        return; // warn-only mode
    }
    console.log('\n🎉 All extensions installed with correct versions (after waiting for auto-resolution if needed).');
}
//# sourceMappingURL=bootstrap-extensions.test.js.map