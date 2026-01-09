export const staticProvisionParams = {
    workspaceMountConsistency: 'cached' as 'cached',
    defaultUserEnvProbe: 'loginInteractiveShell' as 'loginInteractiveShell',
    logFormat: 'text' as 'text',
    removeExistingContainer: false,
    buildNoCache: false,
    expectExistingContainer: false,
    postCreateEnabled: true,
    skipNonBlocking: false,
    prebuild: false,
    additionalMounts: [],
    updateRemoteUserUIDDefault: 'on' as 'on',
    additionalCacheFroms: [],
    dockerPath: undefined,
    dockerComposePath: undefined,
    containerDataFolder: undefined,
    containerSystemDataFolder: undefined,
    configFile: undefined,
    overrideConfigFile: undefined,
    persistedFolder: undefined,
    terminalDimensions: undefined,
    useBuildKit: 'auto' as 'auto',
    buildxPlatform: undefined,
    buildxPush: false,
    buildxOutput: undefined,
    buildxCacheTo: undefined,
    skipPostAttach: false,
};

export const staticExecParams = {
    'user-data-folder': undefined,
    'docker-path': undefined,
    'docker-compose-path': undefined,
    'container-data-folder': undefined,
    'container-system-data-folder': undefined,
    'id-label': undefined,
    'config': undefined,
    'override-config': undefined,
    'terminal-rows': undefined,
    'terminal-columns': undefined,
    'container-id': undefined,
    'mount-workspace-git-root': true,
    'log-level': 'info' as 'info',
    'log-format': 'text' as 'text',
    'default-user-env-probe': 'loginInteractiveShell' as 'loginInteractiveShell',
};

export interface LaunchResult {
    disposables?: (() => Promise<unknown> | undefined)[];
    containerId: string;
    remoteUser?: string;
    remoteWorkspaceFolder?: string | undefined;
    finishBackgroundTasks?: () => Promise<void>;
    containerHost?: string;
    containerPort?: any;
}

// dev-container-features-test-lib
export const testLibraryScript = `
#!/bin/bash
SCRIPT_FOLDER="$(cd "$(dirname $0)" && pwd)"
USERNAME=\${1:-root}

if [ -z $HOME ]; then
    HOME="/root"
fi

FAILED=()

echoStderr()
{
    echo "$@" 1>&2
}

check() {
    LABEL=$1
    shift
    echo -e "\n"
    echo -e "🔄 Testing '$LABEL'"
    echo -e '\\033[37m'
    if "$@"; then
        echo -e "\n" 
        echo "✅  Passed '$LABEL'!"
        return 0
    else
        echo -e "\n"
        echoStderr "❌ $LABEL check failed."
        FAILED+=("$LABEL")
        return 1
    fi
}

checkMultiple() {
    PASSED=0
    LABEL="$1"
    echo -e "\n"
    echo -e "🔄 Testing '$LABEL'."
    shift; MINIMUMPASSED=$1
    shift; EXPRESSION="$1"
    while [ "$EXPRESSION" != "" ]; do
        if $EXPRESSION; then ((PASSED+=1)); fi
        shift; EXPRESSION=$1
    done
    if [ $PASSED -ge $MINIMUMPASSED ]; then
        echo -e "\n"
        echo "✅ Passed!"
        return 0
    else
        echo -e "\n"
        echoStderr "❌ '$LABEL' check failed."
        FAILED+=("$LABEL")
        return 1
    fi
}

reportResults() {
    if [ \${#FAILED[@]} -ne 0 ]; then
        echo -e "\n"
        echoStderr -e "💥  Failed tests: \${FAILED[@]}"
        exit 1
    else
        echo -e "\n"
        echo -e "Test Passed!"
        exit 0
    fi
}`;
