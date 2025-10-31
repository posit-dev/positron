"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromMarketplace = fromMarketplace;
exports.fromPositUrl = fromPositUrl;
exports.fromVsix = fromVsix;
exports.fromGithub = fromGithub;
exports.packageNonNativeLocalExtensionsStream = packageNonNativeLocalExtensionsStream;
exports.packageNativeLocalExtensionsStream = packageNativeLocalExtensionsStream;
exports.packageAllLocalExtensionsStream = packageAllLocalExtensionsStream;
exports.packageMarketplaceExtensionsStream = packageMarketplaceExtensionsStream;
exports.packageBootstrapExtensionsStream = packageBootstrapExtensionsStream;
exports.scanBuiltinExtensions = scanBuiltinExtensions;
exports.translatePackageJSON = translatePackageJSON;
exports.webpackExtensions = webpackExtensions;
exports.buildExtensionMedia = buildExtensionMedia;
exports.copyExtensionBinaries = copyExtensionBinaries;
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const event_stream_1 = __importDefault(require("event-stream"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = __importDefault(require("child_process"));
const glob_1 = __importDefault(require("glob"));
const gulp_1 = __importDefault(require("gulp"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const vinyl_1 = __importDefault(require("vinyl"));
const stats_1 = require("./stats");
const util2 = __importStar(require("./util"));
const gulp_filter_1 = __importDefault(require("gulp-filter"));
const gulp_rename_1 = __importDefault(require("gulp-rename"));
const fancy_log_1 = __importDefault(require("fancy-log"));
const ansi_colors_1 = __importDefault(require("ansi-colors"));
const gulp_buffer_1 = __importDefault(require("gulp-buffer"));
const jsoncParser = __importStar(require("jsonc-parser"));
const dependencies_1 = require("./dependencies");
const builtInExtensions_1 = require("./builtInExtensions");
const bootstrapExtensions_1 = require("./bootstrapExtensions");
const getVersion_1 = require("./getVersion");
const fetch_1 = require("./fetch");
const vzip = require('gulp-vinyl-zip');
// --- Start PWB: from Positron ---
const util_1 = require("./util");
const os_1 = __importDefault(require("os"));
// --- End PWB: from Positron ---
const root = path_1.default.dirname(path_1.default.dirname(__dirname));
const commit = (0, getVersion_1.getVersion)(root);
const sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;
function minifyExtensionResources(input) {
    const jsonFilter = (0, gulp_filter_1.default)(['**/*.json', '**/*.code-snippets'], { restore: true });
    return input
        .pipe(jsonFilter)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(event_stream_1.default.mapSync((f) => {
        const errors = [];
        const value = jsoncParser.parse(f.contents.toString('utf8'), errors, { allowTrailingComma: true });
        if (errors.length === 0) {
            // file parsed OK => just stringify to drop whitespace and comments
            f.contents = Buffer.from(JSON.stringify(value));
        }
        return f;
    }))
        .pipe(jsonFilter.restore);
}
function updateExtensionPackageJSON(input, update) {
    const packageJsonFilter = (0, gulp_filter_1.default)('extensions/*/package.json', { restore: true });
    return input
        .pipe(packageJsonFilter)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(event_stream_1.default.mapSync((f) => {
        const data = JSON.parse(f.contents.toString('utf8'));
        f.contents = Buffer.from(JSON.stringify(update(data)));
        return f;
    }))
        .pipe(packageJsonFilter.restore);
}
function fromLocal(extensionPath, forWeb, disableMangle) {
    const webpackConfigFileName = forWeb
        ? `extension-browser.webpack.config.js`
        : `extension.webpack.config.js`;
    const isWebPacked = fs_1.default.existsSync(path_1.default.join(extensionPath, webpackConfigFileName));
    let input = isWebPacked
        ? fromLocalWebpack(extensionPath, webpackConfigFileName, disableMangle)
        : fromLocalNormal(extensionPath);
    if (isWebPacked) {
        input = updateExtensionPackageJSON(input, (data) => {
            delete data.scripts;
            delete data.dependencies;
            delete data.devDependencies;
            if (data.main) {
                data.main = data.main.replace('/out/', '/dist/');
            }
            return data;
        });
    }
    return input;
}
function fromLocalWebpack(extensionPath, webpackConfigFileName, disableMangle) {
    const vsce = require('@vscode/vsce');
    const webpack = require('webpack');
    const webpackGulp = require('webpack-stream');
    const result = event_stream_1.default.through();
    const packagedDependencies = [];
    const packageJsonConfig = require(path_1.default.join(extensionPath, 'package.json'));
    if (packageJsonConfig.dependencies) {
        const webpackRootConfig = require(path_1.default.join(extensionPath, webpackConfigFileName)).default;
        (0, fancy_log_1.default)('Webpack config:', ansi_colors_1.default.yellow(path_1.default.join(path_1.default.basename(extensionPath), webpackConfigFileName)));
        for (const key in webpackRootConfig.externals) {
            if (key in packageJsonConfig.dependencies) {
                packagedDependencies.push(key);
            }
        }
    }
    // TODO: add prune support based on packagedDependencies to vsce.PackageManager.Npm similar
    // to vsce.PackageManager.Yarn.
    // A static analysis showed there are no webpack externals that are dependencies of the current
    // local extensions so we can use the vsce.PackageManager.None config to ignore dependencies list
    // as a temporary workaround.
    // --- Start Positron ---
    // As noted above in the TODO, the upstream strategy is currently to ignore
    // external dependencies, and some built-in extensions (e.g. git) do not
    // package correctly with the Npm strategy. However, several Positron
    // extensions have npm dependencies that need to be packaged. This list is
    // used to determine which extensions should be packaged with the Npm
    // strategy.
    const extensionsWithNpmDeps = [
        'positron-proxy',
        'positron-duckdb'
    ];
    // If the extension has npm dependencies, use the Npm package manager
    // dependency strategy.
    const packageManger = extensionsWithNpmDeps.includes(packageJsonConfig.name) ?
        vsce.PackageManager.Npm :
        vsce.PackageManager.None;
    // --- Start PWB: from Positron ---
    // Replace vsce.listFiles with listExtensionFiles to queue the work
    listExtensionFiles({ cwd: extensionPath, packageManager: packageManger, packagedDependencies }).then(fileNames => {
        // check for a webpack configuration files, then invoke webpack
        // and merge its output with the files stream.
        const webpackConfigLocations = glob_1.default.sync(path_1.default.join(extensionPath, '**', webpackConfigFileName), { ignore: ['**/node_modules'] });
        const webpackStreams = webpackConfigLocations.flatMap(webpackConfigPath => {
            const webpackDone = (err, stats) => {
                (0, fancy_log_1.default)(`Bundled extension: ${ansi_colors_1.default.yellow(path_1.default.join(path_1.default.basename(extensionPath), path_1.default.relative(extensionPath, webpackConfigPath)))}...`);
                if (err) {
                    result.emit('error', err);
                }
                const { compilation } = stats;
                if (compilation.errors.length > 0) {
                    result.emit('error', compilation.errors.join('\n'));
                }
                if (compilation.warnings.length > 0) {
                    result.emit('error', compilation.warnings.join('\n'));
                }
            };
            const exportedConfig = require(webpackConfigPath).default;
            return (Array.isArray(exportedConfig) ? exportedConfig : [exportedConfig]).map(config => {
                const webpackConfig = {
                    ...config,
                    ...{ mode: 'production' }
                };
                if (disableMangle) {
                    if (Array.isArray(config.module.rules)) {
                        for (const rule of config.module.rules) {
                            if (Array.isArray(rule.use)) {
                                for (const use of rule.use) {
                                    if (String(use.loader).endsWith('mangle-loader.js')) {
                                        use.options.disabled = true;
                                    }
                                }
                            }
                        }
                    }
                }
                const relativeOutputPath = path_1.default.relative(extensionPath, webpackConfig.output.path);
                return webpackGulp(webpackConfig, webpack, webpackDone)
                    .pipe(event_stream_1.default.through(function (data) {
                    data.stat = data.stat || {};
                    data.base = extensionPath;
                    this.emit('data', data);
                }))
                    .pipe(event_stream_1.default.through(function (data) {
                    // source map handling:
                    // * rewrite sourceMappingURL
                    // * save to disk so that upload-task picks this up
                    if (path_1.default.extname(data.basename) === '.js') {
                        const contents = data.contents.toString('utf8');
                        data.contents = Buffer.from(contents.replace(/\n\/\/# sourceMappingURL=(.*)$/gm, function (_m, g1) {
                            return `\n//# sourceMappingURL=${sourceMappingURLBase}/extensions/${path_1.default.basename(extensionPath)}/${relativeOutputPath}/${g1}`;
                        }), 'utf8');
                    }
                    this.emit('data', data);
                }));
            });
        });
        const localFilesStream = createSequentialFileStream(extensionPath, fileNames);
        event_stream_1.default.merge(...webpackStreams, localFilesStream)
            // .pipe(es.through(function (data) {
            // 	// debug
            // 	console.log('out', data.path, data.contents.length);
            // 	this.emit('data', data);
            // }))
            .pipe(result);
    }).catch(err => {
        console.error(extensionPath);
        console.error(packagedDependencies);
        result.emit('error', err);
    });
    // --- End PWB: from Positron ---
    return result.pipe((0, stats_1.createStatsStream)(path_1.default.basename(extensionPath)));
}
function fromLocalNormal(extensionPath) {
    const vsce = require('@vscode/vsce');
    const result = event_stream_1.default.through();
    // --- Start PWB: from Positron ---
    // Replace vsce.listFiles with listExtensionFiles to queue the work
    listExtensionFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Npm })
        .then(fileNames => {
        createSequentialFileStream(extensionPath, fileNames).pipe(result);
    })
        .catch(err => result.emit('error', err));
    // --- End PWB: from Positron ---
    return result.pipe((0, stats_1.createStatsStream)(path_1.default.basename(extensionPath)));
}
const userAgent = 'VSCode Build';
const baseHeaders = {
    'X-Market-Client-Id': 'VSCode Build',
    'User-Agent': userAgent,
    'X-Market-User-Id': '291C1CD0-051A-4123-9B4B-30D60EF52EE2',
};
// --- Start Positron ---
function getPlatformDownloads(bootstrap) {
    // return both architectures for mac universal installer
    if (bootstrap && process.platform === 'darwin' && !process.env['VSCODE_DEV']) {
        return ['darwin-x64', 'darwin-arm64'];
    }
    switch (os_1.default.arch()) {
        case 'arm64':
            return [`${process.platform}-arm64`];
        case 'x64':
        case 'x86_64':
            return [`${process.platform}-x64`];
        default:
            throw new Error(`Unsupported architecture: ${os_1.default.arch()}`);
    }
}
function createPlatformSpecificUrl(serviceUrl, publisher, name, version, platformDownload) {
    return `${serviceUrl}/${publisher}/${name}/${platformDownload}/${version}/file/${publisher}.${name}-${version}@${platformDownload}.vsix`;
}
function getArchFromPlatformId(platformId) {
    if (platformId.includes('arm64')) {
        return 'arm64';
    }
    else if (platformId.includes('x64')) {
        return 'x64';
    }
    return 'unknown';
}
function fromMarketplace(serviceUrl, { name: extensionName, version, sha256, metadata }, bootstrap = false) {
    // --- End Positron ---
    const json = require('gulp-json-editor');
    const [publisher, name] = extensionName.split('.');
    // --- Start Positron ---
    let urls;
    let platformDownloads = [];
    if (metadata.multiPlatformServiceUrl) {
        platformDownloads = getPlatformDownloads(bootstrap);
        urls = platformDownloads.map(platformDownload => createPlatformSpecificUrl(serviceUrl, publisher, name, version, platformDownload));
        (0, fancy_log_1.default)('Downloading multi-platform extension:', ansi_colors_1.default.yellow(`${extensionName}@${version}`), `for ${platformDownloads.join(', ')}...`);
    }
    else {
        urls = [`${serviceUrl}/publishers/${publisher}/vsextensions/${name}/${version}/vspackage`];
        (0, fancy_log_1.default)('Downloading extension:', ansi_colors_1.default.yellow(`${extensionName}@${version}`), '...');
    }
    // --- End Positron ---
    const packageJsonFilter = (0, gulp_filter_1.default)('package.json', { restore: true });
    // --- Start Positron ---
    if (bootstrap) {
        if (urls.length > 1) {
            if (process.platform !== 'darwin') {
                (0, fancy_log_1.default)('Developer error: Unexpected number of URLS for bootstrap extension.');
            }
            return event_stream_1.default.merge(...urls.map((url, index) => {
                const platformId = platformDownloads[index];
                const arch = getArchFromPlatformId(platformId);
                return (0, fetch_1.fetchUrls)('', {
                    base: url,
                    nodeFetchOptions: { headers: baseHeaders },
                    checksumSha256: sha256
                })
                    .pipe((0, gulp_buffer_1.default)())
                    .pipe((0, gulp_rename_1.default)(p => {
                    // Add architecture folder to the path
                    p.dirname = arch;
                }));
            }));
        }
        else {
            return (0, fetch_1.fetchUrls)('', {
                base: urls[0],
                nodeFetchOptions: {
                    headers: baseHeaders
                },
                checksumSha256: sha256
            })
                .pipe((0, gulp_buffer_1.default)());
        }
    }
    else {
        if (urls.length > 1) {
            (0, fancy_log_1.default)(`Developer error: Unexpected number of URLS for built-in extension.`);
        }
        return (0, fetch_1.fetchUrls)('', {
            base: urls[0],
            nodeFetchOptions: {
                headers: baseHeaders
            },
            checksumSha256: sha256
        })
            .pipe(vzip.src())
            .pipe((0, gulp_filter_1.default)('extension/**'))
            .pipe((0, gulp_rename_1.default)(p => p.dirname = p.dirname.replace(/^extension\/?/, '')))
            .pipe(packageJsonFilter)
            .pipe((0, gulp_buffer_1.default)())
            .pipe(json({ __metadata: metadata }))
            .pipe(packageJsonFilter.restore);
    }
    // --- End Positron ---
}
// --- Start PWB: Bundle PWB extension ---
function fromPositUrl({ name: extensionName, version, sha256, positUrl, metadata }) {
    const json = require('gulp-json-editor');
    const [, name] = extensionName.split('.');
    const url = `${positUrl}/${name}-${version}.vsix`;
    (0, fancy_log_1.default)('Downloading extension from Posit CDN:', ansi_colors_1.default.yellow(`${extensionName}@${version}`), '...');
    const packageJsonFilter = (0, gulp_filter_1.default)('package.json', { restore: true });
    return (0, fetch_1.fetchUrls)('', {
        base: url,
        nodeFetchOptions: {
            headers: baseHeaders
        },
        checksumSha256: sha256
    })
        .pipe(vzip.src())
        .pipe((0, gulp_filter_1.default)('extension/**'))
        .pipe((0, gulp_rename_1.default)(p => p.dirname = p.dirname.replace(/^extension\/?/, '')))
        .pipe(packageJsonFilter)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(json({ __metadata: metadata }))
        .pipe(packageJsonFilter.restore);
}
// --- End PWB: Bundle PWB extension ---
function fromVsix(vsixPath, { name: extensionName, version, sha256, metadata }) {
    const json = require('gulp-json-editor');
    (0, fancy_log_1.default)('Using local VSIX for extension:', ansi_colors_1.default.yellow(`${extensionName}@${version}`), '...');
    const packageJsonFilter = (0, gulp_filter_1.default)('package.json', { restore: true });
    return gulp_1.default.src(vsixPath)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(event_stream_1.default.mapSync((f) => {
        const hash = crypto_1.default.createHash('sha256');
        hash.update(f.contents);
        const checksum = hash.digest('hex');
        if (checksum !== sha256) {
            throw new Error(`Checksum mismatch for ${vsixPath} (expected ${sha256}, actual ${checksum}))`);
        }
        return f;
    }))
        .pipe(vzip.src())
        .pipe((0, gulp_filter_1.default)('extension/**'))
        .pipe((0, gulp_rename_1.default)(p => p.dirname = p.dirname.replace(/^extension\/?/, '')))
        .pipe(packageJsonFilter)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(json({ __metadata: metadata }))
        .pipe(packageJsonFilter.restore);
}
function fromGithub({ name, version, repo, sha256, metadata }) {
    const json = require('gulp-json-editor');
    (0, fancy_log_1.default)('Downloading extension from GH:', ansi_colors_1.default.yellow(`${name}@${version}`), '...');
    const packageJsonFilter = (0, gulp_filter_1.default)('package.json', { restore: true });
    return (0, fetch_1.fetchGithub)(new URL(repo).pathname, {
        version,
        name: name => name.endsWith('.vsix'),
        checksumSha256: sha256
    })
        .pipe((0, gulp_buffer_1.default)())
        .pipe(vzip.src())
        .pipe((0, gulp_filter_1.default)('extension/**'))
        .pipe((0, gulp_rename_1.default)(p => p.dirname = p.dirname.replace(/^extension\/?/, '')))
        .pipe(packageJsonFilter)
        .pipe((0, gulp_buffer_1.default)())
        .pipe(json({ __metadata: metadata }))
        .pipe(packageJsonFilter.restore);
}
/**
 * All extensions that are known to have some native component and thus must be built on the
 * platform that is being built.
 */
const nativeExtensions = [
    'microsoft-authentication',
];
const excludedExtensions = [
    'vscode-api-tests',
    'vscode-colorize-tests',
    'vscode-colorize-perf-tests',
    'vscode-test-resolver',
    'ms-vscode.node-debug',
    'ms-vscode.node-debug2',
    // --- Start Positron ---
    'positron-zed',
    'positron-javascript',
    // --- End Positron ---
];
// --- Start Positron ---
// If this is not Windows, exclude the open-remote-wsl extension, which is only
// relevant on Windows.
if (process.platform !== 'win32') {
    excludedExtensions.push('open-remote-wsl');
}
// --- End Positron ---
const marketplaceWebExtensionsExclude = new Set([
    'ms-vscode.node-debug',
    'ms-vscode.node-debug2',
    'ms-vscode.js-debug-companion',
    'ms-vscode.js-debug',
    'ms-vscode.vscode-js-profile-table'
]);
const productJson = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, '../../product.json'), 'utf8'));
const builtInExtensions = productJson.builtInExtensions || [];
// --- Start Positron ---
const bootstrapExtensions = productJson.bootstrapExtensions || [];
// --- End Positron ---
const webBuiltInExtensions = productJson.webBuiltInExtensions || [];
/**
 * Loosely based on `getExtensionKind` from `src/vs/workbench/services/extensions/common/extensionManifestPropertiesService.ts`
 */
function isWebExtension(manifest) {
    if (Boolean(manifest.browser)) {
        return true;
    }
    if (Boolean(manifest.main)) {
        return false;
    }
    // neither browser nor main
    if (typeof manifest.extensionKind !== 'undefined') {
        const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind : [manifest.extensionKind];
        if (extensionKind.indexOf('web') >= 0) {
            return true;
        }
    }
    if (typeof manifest.contributes !== 'undefined') {
        for (const id of ['debuggers', 'terminal', 'typescriptServerPlugins']) {
            if (manifest.contributes.hasOwnProperty(id)) {
                return false;
            }
        }
    }
    return true;
}
/**
 * Package local extensions that are known to not have native dependencies. Mutually exclusive to {@link packageNativeLocalExtensionsStream}.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
function packageNonNativeLocalExtensionsStream(forWeb, disableMangle) {
    return doPackageLocalExtensionsStream(forWeb, disableMangle, false);
}
/**
 * Package local extensions that are known to have native dependencies. Mutually exclusive to {@link packageNonNativeLocalExtensionsStream}.
 * @note it's possible that the extension does not have native dependencies for the current platform, especially if building for the web,
 * but we simplify the logic here by having a flat list of extensions (See {@link nativeExtensions}) that are known to have native
 * dependencies on some platform and thus should be packaged on the platform that they are building for.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
function packageNativeLocalExtensionsStream(forWeb, disableMangle) {
    return doPackageLocalExtensionsStream(forWeb, disableMangle, true);
}
/**
 * Package all the local extensions... both those that are known to have native dependencies and those that are not.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
function packageAllLocalExtensionsStream(forWeb, disableMangle) {
    return event_stream_1.default.merge([
        packageNonNativeLocalExtensionsStream(forWeb, disableMangle),
        packageNativeLocalExtensionsStream(forWeb, disableMangle)
    ]);
}
/**
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @param native build the extensions that are marked as having native dependencies
 */
function doPackageLocalExtensionsStream(forWeb, disableMangle, native) {
    const nativeExtensionsSet = new Set(nativeExtensions);
    const localExtensionsDescriptions = (glob_1.default.sync('extensions/*/package.json')
        .map(manifestPath => {
        const absoluteManifestPath = path_1.default.join(root, manifestPath);
        const extensionPath = path_1.default.dirname(path_1.default.join(root, manifestPath));
        const extensionName = path_1.default.basename(extensionPath);
        return { name: extensionName, path: extensionPath, manifestPath: absoluteManifestPath };
    })
        .filter(({ name }) => native ? nativeExtensionsSet.has(name) : !nativeExtensionsSet.has(name))
        .filter(({ name }) => excludedExtensions.indexOf(name) === -1)
        .filter(({ name }) => builtInExtensions.every(b => b.name !== name))
        .filter(({ manifestPath }) => (forWeb ? isWebExtension(require(manifestPath)) : true)));
    // --- Start Positron ---
    // Process the local extensions serially to avoid running out of file
    // descriptors (EMFILE) when building.
    const localExtensionsStream = event_stream_1.default.through();
    const queue = [...localExtensionsDescriptions];
    function processNext() {
        if (queue.length === 0) {
            localExtensionsStream.end();
            return;
        }
        const extension = queue.shift();
        if (!extension) {
            return;
        }
        const stream = fromLocal(extension.path, forWeb, disableMangle)
            .pipe((0, gulp_rename_1.default)(p => p.dirname = `extensions/${extension.name}/${p.dirname}`))
            .pipe(event_stream_1.default.through(undefined, processNext));
        stream.pipe(localExtensionsStream, { end: false });
    }
    processNext();
    // --- End Positron ---
    let result;
    if (forWeb) {
        result = localExtensionsStream;
    }
    else {
        // also include shared production node modules
        const productionDependencies = (0, dependencies_1.getProductionDependencies)('extensions/');
        const dependenciesSrc = productionDependencies.map(d => path_1.default.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat();
        result = event_stream_1.default.merge(localExtensionsStream, gulp_1.default.src(dependenciesSrc, { base: '.' })
            .pipe(util2.cleanNodeModules(path_1.default.join(root, 'build', '.moduleignore')))
            .pipe(util2.cleanNodeModules(path_1.default.join(root, 'build', `.moduleignore.${process.platform}`))));
    }
    return (result
        .pipe(util2.setExecutableBit(['**/*.sh'])));
}
function packageMarketplaceExtensionsStream(forWeb) {
    const marketplaceExtensionsDescriptions = [
        ...builtInExtensions.filter(({ name }) => (forWeb ? !marketplaceWebExtensionsExclude.has(name) : true)),
        ...(forWeb ? webBuiltInExtensions : [])
    ];
    const marketplaceExtensionsStream = minifyExtensionResources(event_stream_1.default.merge(...marketplaceExtensionsDescriptions
        .map(extension => {
        const src = (0, builtInExtensions_1.getExtensionStream)(extension).pipe((0, gulp_rename_1.default)(p => p.dirname = `extensions/${p.dirname}`));
        return updateExtensionPackageJSON(src, (data) => {
            delete data.scripts;
            delete data.dependencies;
            delete data.devDependencies;
            return data;
        });
    })));
    return (marketplaceExtensionsStream
        .pipe(util2.setExecutableBit(['**/*.sh'])));
}
// --- Start Positron ---
function packageBootstrapExtensionsStream() {
    return event_stream_1.default.merge(...bootstrapExtensions
        .map(extension => {
        const src = (0, bootstrapExtensions_1.getBootstrapExtensionStream)(extension).pipe((0, gulp_rename_1.default)(p => {
            p.dirname = `extensions/bootstrap/${p.dirname}`;
        }));
        return src;
    }));
}
function scanBuiltinExtensions(extensionsRoot, exclude = []) {
    const scannedExtensions = [];
    try {
        const extensionsFolders = fs_1.default.readdirSync(extensionsRoot);
        for (const extensionFolder of extensionsFolders) {
            if (exclude.indexOf(extensionFolder) >= 0) {
                continue;
            }
            const packageJSONPath = path_1.default.join(extensionsRoot, extensionFolder, 'package.json');
            if (!fs_1.default.existsSync(packageJSONPath)) {
                continue;
            }
            const packageJSON = JSON.parse(fs_1.default.readFileSync(packageJSONPath).toString('utf8'));
            if (!isWebExtension(packageJSON)) {
                continue;
            }
            const children = fs_1.default.readdirSync(path_1.default.join(extensionsRoot, extensionFolder));
            const packageNLSPath = children.filter(child => child === 'package.nls.json')[0];
            const packageNLS = packageNLSPath ? JSON.parse(fs_1.default.readFileSync(path_1.default.join(extensionsRoot, extensionFolder, packageNLSPath)).toString()) : undefined;
            const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
            const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];
            scannedExtensions.push({
                extensionPath: extensionFolder,
                packageJSON,
                packageNLS,
                readmePath: readme ? path_1.default.join(extensionFolder, readme) : undefined,
                changelogPath: changelog ? path_1.default.join(extensionFolder, changelog) : undefined,
            });
        }
        return scannedExtensions;
    }
    catch (ex) {
        return scannedExtensions;
    }
}
function translatePackageJSON(packageJSON, packageNLSPath) {
    const CharCode_PC = '%'.charCodeAt(0);
    const packageNls = JSON.parse(fs_1.default.readFileSync(packageNLSPath).toString());
    const translate = (obj) => {
        for (const key in obj) {
            const val = obj[key];
            if (Array.isArray(val)) {
                val.forEach(translate);
            }
            else if (val && typeof val === 'object') {
                translate(val);
            }
            else if (typeof val === 'string' && val.charCodeAt(0) === CharCode_PC && val.charCodeAt(val.length - 1) === CharCode_PC) {
                const translated = packageNls[val.substr(1, val.length - 2)];
                if (translated) {
                    obj[key] = typeof translated === 'string' ? translated : (typeof translated.message === 'string' ? translated.message : val);
                }
            }
        }
    };
    translate(packageJSON);
    return packageJSON;
}
const extensionsPath = path_1.default.join(root, 'extensions');
// Additional projects to run esbuild on. These typically build code for webviews
const esbuildMediaScripts = [
    'ipynb/esbuild.mjs',
    'markdown-language-features/esbuild-notebook.mjs',
    'markdown-language-features/esbuild-preview.mjs',
    'markdown-math/esbuild.mjs',
    'mermaid-chat-features/esbuild-chat-webview.mjs',
    'notebook-renderers/esbuild.mjs',
    'simple-browser/esbuild-preview.mjs',
    // --- Start Positron ---
    'positron-ipywidgets/renderer/esbuild.js',
    // --- End Positron ---
];
async function webpackExtensions(taskName, isWatch, webpackConfigLocations) {
    const webpack = require('webpack');
    const webpackConfigs = [];
    for (const { configPath, outputRoot } of webpackConfigLocations) {
        const configOrFnOrArray = require(configPath).default;
        function addConfig(configOrFnOrArray) {
            for (const configOrFn of Array.isArray(configOrFnOrArray) ? configOrFnOrArray : [configOrFnOrArray]) {
                const config = typeof configOrFn === 'function' ? configOrFn({}, {}) : configOrFn;
                if (outputRoot) {
                    config.output.path = path_1.default.join(outputRoot, path_1.default.relative(path_1.default.dirname(configPath), config.output.path));
                }
                webpackConfigs.push(config);
            }
        }
        addConfig(configOrFnOrArray);
    }
    function reporter(fullStats) {
        if (Array.isArray(fullStats.children)) {
            for (const stats of fullStats.children) {
                const outputPath = stats.outputPath;
                if (outputPath) {
                    const relativePath = path_1.default.relative(extensionsPath, outputPath).replace(/\\/g, '/');
                    const match = relativePath.match(/[^\/]+(\/server|\/client)?/);
                    (0, fancy_log_1.default)(`Finished ${ansi_colors_1.default.green(taskName)} ${ansi_colors_1.default.cyan(match[0])} with ${stats.errors.length} errors.`);
                }
                if (Array.isArray(stats.errors)) {
                    stats.errors.forEach((error) => {
                        fancy_log_1.default.error(error);
                    });
                }
                if (Array.isArray(stats.warnings)) {
                    stats.warnings.forEach((warning) => {
                        fancy_log_1.default.warn(warning);
                    });
                }
            }
        }
    }
    return new Promise((resolve, reject) => {
        if (isWatch) {
            webpack(webpackConfigs).watch({}, (err, stats) => {
                if (err) {
                    reject();
                }
                else {
                    reporter(stats?.toJson());
                }
            });
        }
        else {
            webpack(webpackConfigs).run((err, stats) => {
                if (err) {
                    fancy_log_1.default.error(err);
                    reject();
                }
                else {
                    reporter(stats?.toJson());
                    resolve();
                }
            });
        }
    });
}
async function esbuildExtensions(taskName, isWatch, scripts) {
    function reporter(stdError, script) {
        const matches = (stdError || '').match(/\> (.+): error: (.+)?/g);
        (0, fancy_log_1.default)(`Finished ${ansi_colors_1.default.green(taskName)} ${script} with ${matches ? matches.length : 0} errors.`);
        for (const match of matches || []) {
            fancy_log_1.default.error(match);
        }
    }
    const tasks = scripts.map(({ script, outputRoot }) => {
        return new Promise((resolve, reject) => {
            const args = [script];
            if (isWatch) {
                args.push('--watch');
            }
            if (outputRoot) {
                args.push('--outputRoot', outputRoot);
            }
            const proc = child_process_1.default.execFile(process.argv[0], args, {}, (error, _stdout, stderr) => {
                if (error) {
                    return reject(error);
                }
                reporter(stderr, script);
                return resolve();
            });
            proc.stdout.on('data', (data) => {
                (0, fancy_log_1.default)(`${ansi_colors_1.default.green(taskName)}: ${data.toString('utf8')}`);
            });
        });
    });
    return Promise.all(tasks);
}
async function buildExtensionMedia(isWatch, outputRoot) {
    return esbuildExtensions('esbuilding extension media', isWatch, esbuildMediaScripts.map(p => ({
        script: path_1.default.join(extensionsPath, p),
        outputRoot: outputRoot ? path_1.default.join(root, outputRoot, path_1.default.dirname(p)) : undefined
    })));
}
// --- Start PWB: from Positron ---
/**
 * Create a stream that emits files in the order of `fileNames`, one at a time,
 * reading each file from disk before emitting it.
 *
 * This is used to serialize file reads when packaging extensions, to avoid
 * running out of file descriptors (EMFILE) when building.
 *
 * @param extensionPath The root path of the extension
 * @param fileNames The list of file names to emit, relative to `extensionPath`
 * @returns A stream that emits the files in order
 */
function createSequentialFileStream(extensionPath, fileNames) {
    const stream = event_stream_1.default.through();
    const queue = [...fileNames];
    let ended = false;
    const finish = () => {
        if (!ended) {
            ended = true;
            stream.emit('end');
        }
    };
    stream.on('close', () => {
        ended = true;
        queue.length = 0;
    });
    stream.on('error', () => {
        ended = true;
        queue.length = 0;
    });
    const pump = () => {
        if (ended) {
            return;
        }
        if (queue.length === 0) {
            finish();
            return;
        }
        const relativePath = queue.shift();
        const absolutePath = path_1.default.join(extensionPath, relativePath);
        let stats;
        try {
            stats = fs_1.default.statSync(absolutePath);
        }
        catch (error) {
            ended = true;
            queue.length = 0;
            stream.emit('error', error);
            return;
        }
        let fileStream;
        try {
            fileStream = fs_1.default.createReadStream(absolutePath);
        }
        catch (error) {
            ended = true;
            queue.length = 0;
            stream.emit('error', error);
            return;
        }
        let settled = false;
        const cleanup = () => {
            if (settled) {
                return;
            }
            settled = true;
            fileStream.removeListener('end', cleanup);
            fileStream.removeListener('close', cleanup);
            fileStream.removeListener('error', onError);
            setImmediate(pump);
        };
        const onError = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            fileStream.removeListener('end', cleanup);
            fileStream.removeListener('close', cleanup);
            fileStream.removeListener('error', onError);
            ended = true;
            queue.length = 0;
            stream.emit('error', err);
        };
        fileStream.on('end', cleanup);
        fileStream.on('close', cleanup);
        fileStream.on('error', onError);
        const file = new vinyl_1.default({
            path: absolutePath,
            stat: stats,
            base: extensionPath,
            contents: fileStream
        });
        stream.emit('data', file);
    };
    setImmediate(pump);
    return stream;
}
// Node 20 consistently crashes when there are too many `vsce.listFiles`
// operations in flight at once; these operations are expensive as they recurse
// back into `yarn`. The code below serializes these operations when building
// Positron to avoid these crashes.
/**
 * A class representing a promise to list the files in an extension
 */
class ListPromise extends util_1.PromiseHandles {
    opts;
    constructor(opts) {
        super();
        this.opts = opts;
    }
}
/** A queue of pending list promises */
const listQueue = [];
/** Whether we are currently processing a list promise */
let listBusy = false;
/**
 * Lists the files in an extension.
 *
 * @param opts The list options
 * @returns A promise that resolves with the list of files
 */
function listExtensionFiles(opts) {
    // Create a promise to represent the deferred work
    const promise = new ListPromise(opts);
    listQueue.push(promise);
    // Tickle processing of the work queue
    processListQueue();
    // Return the deferred promise
    return promise.promise;
}
/**
 * Processes the queue of pending work
 */
function processListQueue() {
    const vsce = require('@vscode/vsce');
    // Ignore if we are currently doing work
    if (listBusy) {
        return;
    }
    // Ignore if there's no work to do
    if (listQueue.length === 0) {
        return;
    }
    // Splice off the next piece of work from the front of the array; since new
    // work is pushed to the end, this gives us a FIFO queue
    const next = listQueue.splice(0, 1)[0];
    // Mark as busy so we don't try to do more work
    listBusy = true;
    // Do the work!
    vsce.listFiles(next.opts).then((fileNames) => {
        next.resolve(fileNames);
    }).catch((e) => {
        next.reject(e);
    }).finally(() => {
        // When work is complete, mark no longer busy and move to the next
        // element in the queue, if any
        listBusy = false;
        processListQueue();
    });
}
// This Gulp task is used to copy binaries verbatim from built-in extensions to
// the output folder. VS Code's built-in extensions are webpacked, and weback
// doesn't support copying binaries in any useful way (even with
// CopyWebpackPlugin, binaries are UTF corrupted and lose executable
// permissions), so we need to do it in a separate task.
async function copyExtensionBinaries(outputRoot) {
    return new Promise((resolve, _reject) => {
        // Collect all the Positron extension metadata for binaries that need to
        // be copied.  The Positron extension metadata lives in the
        // `positron.json` file in the extension's root directory.
        const binaryMetadata = (glob_1.default.sync('extensions/*/positron.json')
            .filter(metadataPath => {
            // Don't copy binaries for excluded extensions.
            const extension = path_1.default.basename(path_1.default.dirname(metadataPath));
            return excludedExtensions.indexOf(extension) === -1;
        })
            .map(metadataPath => {
            // Read the metadata file.
            const metadata = JSON.parse(fs_1.default.readFileSync(metadataPath).toString('utf8'));
            // Resolve the paths to the binaries.
            if (metadata.binaries) {
                return metadata.binaries.reduce((result, bin) => {
                    // Filter out binaries that aren't for this platform.
                    if (bin.platforms && !bin.platforms.includes(process.platform)) {
                        return result;
                    }
                    // Check the executable bit. Gulp can lose this on
                    // copy, so we may need to restore it later.
                    const src = path_1.default.join(path_1.default.dirname(metadataPath), bin.from);
                    let isExecutable = false;
                    if (fs_1.default.existsSync(src)) {
                        const stat = fs_1.default.statSync(src);
                        isExecutable = (stat.mode & 0o100) !== 0;
                    }
                    result.push({
                        ...bin,
                        exe: isExecutable,
                        base: path_1.default.basename(path_1.default.dirname(metadataPath)),
                    });
                    return result;
                }, []);
            }
            return null;
        })).flat();
        (0, fancy_log_1.default)(`Copying ${binaryMetadata.length} binary sets for built-in Positron extensions`);
        // Create a stream of all the binaries.
        event_stream_1.default.merge(
        // Map the metadata to a stream of Vinyl files from the source to the
        // destination.
        ...binaryMetadata.map((bin) => {
            const srcLoc = path_1.default.resolve('extensions', bin.base, bin.from);
            const destLoc = path_1.default.resolve(outputRoot, bin.base, bin.to);
            return gulp_1.default.src(srcLoc).pipe(gulp_1.default.dest(destLoc));
        }), 
        // Restore the executable bit on the binaries that had it.
        util2.setExecutableBit(binaryMetadata
            .filter((bin) => bin.exe)
            .map((bin) => path_1.default.join(outputRoot, bin.base, bin.to))));
        resolve();
    });
}
// --- End PWB: from Positron ---
//# sourceMappingURL=extensions.js.map