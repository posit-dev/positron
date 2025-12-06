/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { LogLevel } from '../spec-utils/log';

import { ResolverParameters, ContainerProperties, createFileCommand } from './injectHeadless';

const installCommands = [
	'install.sh',
	'install',
	'bootstrap.sh',
	'bootstrap',
	'script/bootstrap',
	'setup.sh',
	'setup',
	'script/setup',
];

export async function installDotfiles(params: ResolverParameters, properties: ContainerProperties, dockerEnvP: Promise<Record<string, string>>, secretsP: Promise<Record<string, string>>) {
	let { repository, installCommand, targetPath } = params.dotfilesConfiguration;
	if (!repository) {
		return;
	}
	if (repository.indexOf(':') === -1 && !/^\.{0,2}\//.test(repository)) {
		repository = `https://github.com/${repository}.git`;
	}
	const shellServer = properties.shellServer;
	const markerFile = getDotfilesMarkerFile(properties);
	const dockerEnvAndSecrets = { ...await dockerEnvP, ...await secretsP };
	const allEnv = Object.keys(dockerEnvAndSecrets)
		.filter(key => !(key.startsWith('BASH_FUNC_') && key.endsWith('%%')))
		.reduce((env, key) => `${env}${key}=${quoteValue(dockerEnvAndSecrets[key])} `, '');
	try {
		params.output.event({
			type: 'progress',
			name: 'Installing Dotfiles',
			status: 'running',
		});
		if (installCommand) {
			await shellServer.exec(`# Clone & install dotfiles via '${installCommand}'
${createFileCommand(markerFile)} || (echo dotfiles marker found && exit 1) || exit 0
command -v git >/dev/null 2>&1 || (echo git not found && exit 1) || exit 0
[ -e ${targetPath} ] || ${allEnv}git clone --depth 1 ${repository} ${targetPath} || exit $?
echo Setting current directory to '${targetPath}'
cd ${targetPath}

if [ -f "./${installCommand}" ]
then
	if [ ! -x "./${installCommand}" ]
	then
		echo Setting './${installCommand}' as executable
		chmod +x "./${installCommand}"
	fi
	echo Executing command './${installCommand}'..\n
	${allEnv}"./${installCommand}"
elif [ -f "${installCommand}" ]
then
	if [ ! -x "${installCommand}" ]
	then
		echo Setting '${installCommand}' as executable
		chmod +x "${installCommand}"
	fi
	echo Executing command '${installCommand}'...\n
	${allEnv}"${installCommand}"
else
	echo Could not locate '${installCommand}'...\n
	exit 126
fi
`, { logOutput: 'continuous', logLevel: LogLevel.Info });
		} else {
			await shellServer.exec(`# Clone & install dotfiles
${createFileCommand(markerFile)} || (echo dotfiles marker found && exit 1) || exit 0
command -v git >/dev/null 2>&1 || (echo git not found && exit 1) || exit 0
[ -e ${targetPath} ] || ${allEnv}git clone --depth 1 ${repository} ${targetPath} || exit $?
echo Setting current directory to ${targetPath}
cd ${targetPath}
for f in ${installCommands.join(' ')}
do
	if [ -e $f ]
	then
		installCommand=$f
		break
	fi
done
if [ -z "$installCommand" ]
then
	dotfiles=$(ls -d ${targetPath}/.* 2>/dev/null | grep -v -E '/(.|..|.git)$')
	if [ ! -z "$dotfiles" ]
	then
		echo Linking dotfiles: $dotfiles
		ln -sf $dotfiles ~ 2>/dev/null
	else
		echo No dotfiles found.
	fi
else
	if [ ! -x "$installCommand" ]
	then
	   echo Setting '${targetPath}'/"$installCommand" as executable
	   chmod +x "$installCommand"
	fi

	echo Executing command '${targetPath}'/"$installCommand"...\n
	${allEnv}./"$installCommand"
fi
`, { logOutput: 'continuous', logLevel: LogLevel.Info });
		}
		params.output.event({
			type: 'progress',
			name: 'Installing Dotfiles',
			status: 'succeeded',
		});
	} catch (err) {
		params.output.event({
			type: 'progress',
			name: 'Installing Dotfiles',
			status: 'failed',
		});
	}
}

function quoteValue(value: string | undefined) {
	return `'${(value || '').replace(/'+/g, '\'"$&"\'')}'`;
}

function getDotfilesMarkerFile(properties: ContainerProperties) {
	return path.posix.join(properties.userDataFolder, '.dotfilesMarker');
}
