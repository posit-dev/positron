"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBootstrapExtensionStream = getBootstrapExtensionStream;
exports.getBootstrapExtensions = getBootstrapExtensions;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const rimraf = __importStar(require("rimraf"));
const es = __importStar(require("event-stream"));
const vfs = __importStar(require("vinyl-fs"));
const ext = __importStar(require("./extensions"));
const ansiColors = __importStar(require("ansi-colors"));
const gulp_rename_1 = __importDefault(require("gulp-rename"));
const fancy_log_1 = __importDefault(require("fancy-log"));
const root = path.dirname(path.dirname(__dirname));
const productjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BOOTSTRAP_EXTENSIONS_SILENCE_PLEASE'];
const bootstrapExtensions = productjson.bootstrapExtensions || [];
const controlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'bootstrap-control.json');
function log(...messages) {
    if (ENABLE_LOGGING) {
        (0, fancy_log_1.default)(...messages);
    }
}
function getExtensionPath(extension) {
    return path.join(root, '.build', 'bootstrapExtensions', `${extension.name}-${extension.version}.vsix`);
}
function isUpToDate(extension) {
    const regex = new RegExp(`^${extension.name}-(\\d+\\.\\d+\\.\\d+)\\.vsix$`);
    const bootstrapDir = path.join(root, '.build', 'bootstrapExtensions');
    if (!fs.existsSync(bootstrapDir)) {
        return false;
    }
    const files = fs.readdirSync(bootstrapDir);
    const matchingFiles = files.filter(f => regex.test(f));
    for (const vsixPath of matchingFiles) {
        try {
            const match = vsixPath.match(regex);
            const diskVersion = match ? match[1] : null;
            if (diskVersion !== extension.version) {
                log(`[extensions]`, `Outdated version detected, deleting ${vsixPath}`);
                fs.unlinkSync(path.join(bootstrapDir, vsixPath));
            }
            else {
                log(`[extensions]`, `Found up-to-date extension: ${vsixPath}`);
                return true;
            }
        }
        catch (err) {
            log(`[extensions]`, `Error checking version of ${vsixPath}`, err);
            return false;
        }
    }
    return false;
}
function getExtensionDownloadStream(extension) {
    const url = extension.metadata.multiPlatformServiceUrl || productjson.extensionsGallery?.serviceUrl;
    return (url ? ext.fromMarketplace(url, extension, true) : ext.fromGithub(extension))
        .pipe((0, gulp_rename_1.default)(p => { p.basename = `${extension.name}-${extension.version}.vsix`; }));
}
function getBootstrapExtensionStream(extension) {
    // if the extension exists on disk, use those files instead of downloading anew
    if (isUpToDate(extension)) {
        log('[extensions]', `${extension.name}@${extension.version} up to date`, ansiColors.green('✔︎'));
        return vfs.src(['**'], { cwd: getExtensionPath(extension), dot: true })
            .pipe((0, gulp_rename_1.default)(p => p.dirname = `${extension.name}/${p.dirname}`));
    }
    return getExtensionDownloadStream(extension);
}
function syncMarketplaceExtension(extension) {
    const galleryServiceUrl = productjson.extensionsGallery?.serviceUrl;
    const source = ansiColors.blue(galleryServiceUrl ? '[marketplace]' : '[github]');
    if (isUpToDate(extension)) {
        log(source, `${extension.name}@${extension.version}`, ansiColors.green('✔︎'));
        return es.readArray([]);
    }
    rimraf.sync(getExtensionPath(extension));
    return getExtensionDownloadStream(extension)
        .pipe(vfs.dest('.build/bootstrapExtensions'))
        .on('end', () => log(source, extension.name, ansiColors.green('✔︎')));
}
function syncExtension(extension, controlState) {
    if (extension.platforms) {
        const platforms = new Set(extension.platforms);
        if (!platforms.has(process.platform)) {
            log(ansiColors.gray('[skip]'), `${extension.name}@${extension.version}: Platform '${process.platform}' not supported: [${extension.platforms}]`, ansiColors.green('✔︎'));
            return es.readArray([]);
        }
    }
    switch (controlState) {
        case 'disabled':
            log(ansiColors.blue('[disabled]'), ansiColors.gray(extension.name));
            return es.readArray([]);
        case 'marketplace':
            return syncMarketplaceExtension(extension);
        default:
            if (!fs.existsSync(controlState)) {
                log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
                return es.readArray([]);
            }
            else if (!fs.existsSync(path.join(controlState, 'package.json'))) {
                log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
                return es.readArray([]);
            }
            log(ansiColors.blue('[local]'), `${extension.name}: ${ansiColors.cyan(controlState)}`, ansiColors.green('✔︎'));
            return es.readArray([]);
    }
}
function readControlFile() {
    try {
        return JSON.parse(fs.readFileSync(controlFilePath, 'utf8'));
    }
    catch (err) {
        return {};
    }
}
function writeControlFile(control) {
    fs.mkdirSync(path.dirname(controlFilePath), { recursive: true });
    fs.writeFileSync(controlFilePath, JSON.stringify(control, null, 2));
}
function getBootstrapExtensions() {
    const control = readControlFile();
    const streams = [];
    for (const extension of [...bootstrapExtensions]) {
        const controlState = control[extension.name] || 'marketplace';
        control[extension.name] = controlState;
        streams.push(syncExtension(extension, controlState));
    }
    writeControlFile(control);
    return new Promise((resolve, reject) => {
        es.merge(streams)
            .on('error', reject)
            .on('end', resolve);
    });
}
if (require.main === module) {
    getBootstrapExtensions().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=bootstrapExtensions.js.map