/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* jshint node: true */
/* jshint esversion: 6 */

'use strict';

const gulp = require('gulp');
const ts = require('gulp-typescript');
const spawn = require('cross-spawn');
const path = require('path');
const del = require('del');
const fsExtra = require('fs-extra');
const glob = require('glob');
const _ = require('lodash');
const nativeDependencyChecker = require('node-has-native-dependencies');
const flat = require('flat');
const { argv } = require('yargs');
const os = require('os');
// --- Start Positron ---
const fancyLog = require('fancy-log');
const ansiColors = require('ansi-colors');
// --- End Positron ---
const typescript = require('typescript');

const tsProject = ts.createProject('./tsconfig.json', { typescript });

const isCI = process.env.TRAVIS === 'true' || process.env.TF_BUILD !== undefined;

// --- Start Positron ---
const pythonCommand = locatePython();
const arch = os.arch();
if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported architecture: ${arch}`);
}
// --- End Positron ---

gulp.task('compileCore', (done) => {
    let failed = false;
    tsProject
        .src()
        .pipe(tsProject())
        .on('error', () => {
            failed = true;
        })
        .js.pipe(gulp.dest('out'))
        .on('finish', () => (failed ? done(new Error('TypeScript compilation errors')) : done()));
});

gulp.task('compileApi', (done) => {
    spawnAsync('npm', ['run', 'compileApi'], undefined, true)
        .then((stdout) => {
            if (stdout.includes('error')) {
                done(new Error(stdout));
            } else {
                done();
            }
        })
        .catch((ex) => {
            console.log(ex);
            done(new Error('TypeScript compilation errors', ex));
        });
});

gulp.task('compile', gulp.series('compileCore', 'compileApi'));

gulp.task('precommit', (done) => run({ exitOnError: true, mode: 'staged' }, done));

gulp.task('output:clean', () => del(['coverage']));

gulp.task('clean:cleanExceptTests', () => del(['clean:vsix', 'out/client']));
gulp.task('clean:vsix', () => del(['*.vsix']));
gulp.task('clean:out', () => del(['out']));

gulp.task('clean', gulp.parallel('output:clean', 'clean:vsix', 'clean:out'));

gulp.task('checkNativeDependencies', (done) => {
    if (hasNativeDependencies()) {
        done(new Error('Native dependencies detected'));
    }
    done();
});

const webpackEnv = { NODE_OPTIONS: '--max_old_space_size=9096' };

async function buildWebPackForDevOrProduction(configFile, configNameForProductionBuilds) {
    if (configNameForProductionBuilds) {
        await buildWebPack(configNameForProductionBuilds, ['--config', configFile], webpackEnv);
    } else {
        await spawnAsync('npm', ['run', 'webpack', '--', '--config', configFile, '--mode', 'production'], webpackEnv);
    }
}
gulp.task('webpack', async () => {
    // Build node_modules.
    await buildWebPackForDevOrProduction('./build/webpack/webpack.extension.dependencies.config.js', 'production');
    await buildWebPackForDevOrProduction('./build/webpack/webpack.extension.config.js', 'extension');
    await buildWebPackForDevOrProduction('./build/webpack/webpack.extension.browser.config.js', 'browser');
});

gulp.task('addExtensionPackDependencies', async () => {
    await buildLicense();
    await addExtensionPackDependencies();
});

async function addExtensionPackDependencies() {
    // Update the package.json to add extension pack dependencies at build time so that
    // extension dependencies need not be installed during development
    const packageJsonContents = await fsExtra.readFile('package.json', 'utf-8');
    const packageJson = JSON.parse(packageJsonContents);
    // --- Start Positron ---
    packageJson.extensionPack = ['ms-python.debugpy'].concat(
        // --- End Positron ---
        packageJson.extensionPack ? packageJson.extensionPack : [],
    );
    // Remove potential duplicates.
    packageJson.extensionPack = packageJson.extensionPack.filter(
        (item, index) => packageJson.extensionPack.indexOf(item) === index,
    );
    await fsExtra.writeFile('package.json', JSON.stringify(packageJson, null, 4), 'utf-8');
}

async function buildLicense() {
    const headerPath = path.join(__dirname, 'build', 'license-header.txt');
    const licenseHeader = await fsExtra.readFile(headerPath, 'utf-8');
    const license = await fsExtra.readFile('LICENSE', 'utf-8');

    await fsExtra.writeFile('LICENSE', `${licenseHeader}\n${license}`, 'utf-8');
}

gulp.task('updateBuildNumber', async () => {
    await updateBuildNumber(argv);
});

async function updateBuildNumber(args) {
    if (args && args.buildNumber) {
        // Edit the version number from the package.json
        const packageJsonContents = await fsExtra.readFile('package.json', 'utf-8');
        const packageJson = JSON.parse(packageJsonContents);

        // Change version number
        const versionParts = packageJson.version.split('.');
        const buildNumberPortion =
            versionParts.length > 2 ? versionParts[2].replace(/(\d+)/, args.buildNumber) : args.buildNumber;
        const newVersion =
            versionParts.length > 1
                ? `${versionParts[0]}.${versionParts[1]}.${buildNumberPortion}`
                : packageJson.version;
        packageJson.version = newVersion;

        // Write back to the package json
        await fsExtra.writeFile('package.json', JSON.stringify(packageJson, null, 4), 'utf-8');

        // Update the changelog.md if we are told to (this should happen on the release branch)
        if (args.updateChangelog) {
            const changeLogContents = await fsExtra.readFile('CHANGELOG.md', 'utf-8');
            const fixedContents = changeLogContents.replace(
                /##\s*(\d+)\.(\d+)\.(\d+)\s*\(/,
                `## $1.$2.${buildNumberPortion} (`,
            );

            // Write back to changelog.md
            await fsExtra.writeFile('CHANGELOG.md', fixedContents, 'utf-8');
        }
    } else {
        throw Error('buildNumber argument required for updateBuildNumber task');
    }
}

async function buildWebPack(webpackConfigName, args, env) {
    // Remember to perform a case insensitive search.
    const allowedWarnings = getAllowedWarningsForWebPack(webpackConfigName).map((item) => item.toLowerCase());
    const stdOut = await spawnAsync(
        'npm',
        ['run', 'webpack', '--', ...args, ...['--mode', 'production', '--devtool', 'source-map']],
        env,
    );
    const stdOutLines = stdOut
        .split(os.EOL)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    // Remember to perform a case insensitive search.
    const warnings = stdOutLines
        .filter((item) => item.startsWith('WARNING in '))
        .filter(
            (item) =>
                allowedWarnings.findIndex((allowedWarning) =>
                    item.toLowerCase().startsWith(allowedWarning.toLowerCase()),
                ) === -1,
        );
    const errors = stdOutLines.some((item) => item.startsWith('ERROR in'));
    if (errors) {
        throw new Error(`Errors in ${webpackConfigName}, \n${warnings.join(', ')}\n\n${stdOut}`);
    }
    if (warnings.length > 0) {
        throw new Error(
            `Warnings in ${webpackConfigName}, Check gulpfile.js to see if the warning should be allowed., \n\n${stdOut}`,
        );
    }
}
function getAllowedWarningsForWebPack(buildConfig) {
    switch (buildConfig) {
        case 'production':
            return [
                'WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).',
                'WARNING in entrypoint size limit: The following entrypoint(s) combined asset size exceeds the recommended limit (244 KiB). This can impact web performance.',
                'WARNING in webpack performance recommendations:',
                'WARNING in ./node_modules/encoding/lib/iconv-loader.js',
                'WARNING in ./node_modules/any-promise/register.js',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/out/AutoCollection/NativePerformance.js',
            ];
        case 'extension':
            return [
                'WARNING in ./node_modules/encoding/lib/iconv-loader.js',
                'WARNING in ./node_modules/any-promise/register.js',
                'remove-files-plugin@1.4.0:',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/out/AutoCollection/NativePerformance.js',
            ];
        case 'debugAdapter':
            return [
                'WARNING in ./node_modules/vscode-uri/lib/index.js',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/out/AutoCollection/NativePerformance.js',
            ];
        case 'browser':
            return [
                'WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).',
                'WARNING in entrypoint size limit: The following entrypoint(s) combined asset size exceeds the recommended limit (244 KiB). This can impact web performance.',
                'WARNING in webpack performance recommendations:',
            ];
        default:
            throw new Error('Unknown WebPack Configuration');
    }
}

gulp.task('verifyBundle', async () => {
    const matches = await glob.sync(path.join(__dirname, '*.vsix'));
    if (!matches || matches.length === 0) {
        throw new Error('Bundle does not exist');
    } else {
        console.log(`Bundle ${matches[0]} exists.`);
    }
});

gulp.task('prePublishBundle', gulp.series('webpack'));
gulp.task('checkDependencies', gulp.series('checkNativeDependencies'));
gulp.task('prePublishNonBundle', gulp.series('compile'));

// --- Start Positron ---
async function pipInstall(args) {
    await spawnAsync(pythonCommand, [
        '-m',
        'pip',

        // Silence warnings about pip version.
        '--disable-pip-version-check',

        'install',

        // Upgrade to avoid warnings when rerunning the task.
        '--upgrade',

        // Args for a safer installation.
        '--no-cache-dir',
        '--no-deps',
        '--require-hashes',
        '--only-binary',
        ':all:',

        ...args,
    ]);
}

async function installPythonScriptRequirements() {
    await pipInstall(['--target', './python_files/lib/python', '--implementation', 'py', '-r', './requirements.txt']);
}

async function vendorPythonKernelRequirements() {
    await spawnAsync(pythonCommand, ['scripts/vendor.py']);
}

async function bundleIPykernel() {
    const pythonVersions = ['3.8', '3.9', '3.10', '3.11', '3.12', '3.13'];
    const minimumPythonVersion = '3.8';

    // Pure Python 3 requirements.
    await pipInstall([
        '--target',
        './python_files/lib/ipykernel/py3',
        '--implementation',
        'py',
        '--python-version',
        minimumPythonVersion,
        '--abi',
        'none',
        '-r',
        './python_files/ipykernel_requirements/py3-requirements.txt',
    ]);

    // CPython 3 requirements (specific to platform and architecture).
    await pipInstall([
        '--target',
        `./python_files/lib/ipykernel/${arch}/cp3`,
        '--implementation',
        'cp',
        '--python-version',
        '3.8',
        '--abi',
        'abi3',
        '-r',
        `./python_files/ipykernel_requirements/cp3-requirements.txt`,
    ]);

    // CPython 3.x requirements (specific to platform, architecture, and Python version).
    for (const pythonVersion of pythonVersions) {
        const shortVersion = pythonVersion.replace('.', '');
        const abi = `cp${shortVersion}`;
        await pipInstall([
            '--target',
            `./python_files/lib/ipykernel/${arch}/${abi}`,
            '--implementation',
            'cp',
            '--python-version',
            pythonVersion,
            '--abi',
            abi,
            '-r',
            './python_files/ipykernel_requirements/cpx-requirements.txt',
        ]);
    }
}

gulp.task(
    'installPythonLibs',
    // Run in parallel since vendoring rewrites imports which is somewhat CPU-bound.
    gulp.parallel(vendorPythonKernelRequirements, gulp.series(installPythonScriptRequirements, bundleIPykernel)),
);

function locatePython() {
    let pythonPath = process.env.CI_PYTHON_PATH || 'python3';
    const whichCommand = os.platform() === 'win32' ? 'where' : 'which';
    try {
        const result = spawn.sync(whichCommand, [pythonPath], { encoding: 'utf8' }).stdout.toString();
        if (result.trim().length === 0) {
            throw new Error('Could not find python!');
        }
    } catch (ex) {
        // Otherwise, default to python
        const msg = `Error: could not find python at '${pythonPath}'. Using 'python' instead.`;
        fancyLog.warn(ansiColors.yellow(`warning`), msg);
        pythonPath = 'python';
    }
    return pythonPath;
}

function spawnAsync(command, args, env, rejectOnStdErr = false) {
    env = env || {};
    env = { ...process.env, ...env };
    return new Promise((resolve, reject) => {
        let stdOut = '';
        let stdErr = '';
        console.info(`> ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, { cwd: __dirname, env });
        proc.stdout.on('data', (data) => {
            // Log output on CI (else travis times out when there's not output).
            stdOut += data.toString();
            if (isCI) {
                console.log(data.toString());
            }
        });
        proc.stderr.on('data', (data) => {
            // Capture all of the stdErr to print out if the process fails.
            stdErr += data.toString();
            if (isCI) {
                console.error(stdErr);
            }
        });

        proc.on('close', () => {
            if (proc.exitCode !== 0) {
                reject(
                    new Error(
                        `Process exited with non-zero exit code: ${proc.exitCode}.\n\nStdout:\n\n${stdOut}\n\nStderr:\n\n${stdErr}`,
                    ),
                );
            }
            if (stdErr && rejectOnStdErr) {
                reject(new Error(`Rejecting on stderr.\n\nStdout:\n\n${stdOut}\n\nStderr:\n${stdErr}`));
            }
            resolve(stdOut);
        });
        proc.on('error', (error) => reject(error));
    });
}
// --- End Positron ---

function hasNativeDependencies() {
    let nativeDependencies = nativeDependencyChecker.check(path.join(__dirname, 'node_modules'));
    if (!Array.isArray(nativeDependencies) || nativeDependencies.length === 0) {
        return false;
    }
    const dependencies = JSON.parse(spawn.sync('npm', ['ls', '--json', '--prod']).stdout.toString());
    const jsonProperties = Object.keys(flat.flatten(dependencies));
    nativeDependencies = _.flatMap(nativeDependencies, (item) =>
        path.dirname(item.substring(item.indexOf('node_modules') + 'node_modules'.length)).split(path.sep),
    )
        .filter((item) => item.length > 0)
        .filter((item) => item !== 'fsevents')
        .filter(
            (item) =>
                jsonProperties.findIndex((flattenedDependency) =>
                    flattenedDependency.endsWith(`dependencies.${item}.version`),
                ) >= 0,
        );
    if (nativeDependencies.length > 0) {
        console.error('Native dependencies detected', nativeDependencies);
        return true;
    }
    return false;
}
