/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { execSync } from 'child_process';
import * as os from 'os';

export function readClipboard(): string {
  const platform = os.platform();
  let command: string;

  if (platform === 'darwin') {
    command = 'pbpaste';
  } else if (platform === 'win32') {
    command = 'powershell Get-Clipboard';
  } else if (platform === 'linux') {
    command = 'xclip -selection clipboard -o';
  } else {
    throw new Error('Unsupported platform: ' + platform);
  }

  return execSync(command).toString();
}

export function writeClipboard(text: string): void {
  const platform = os.platform();
  let command: string;

  if (platform === 'darwin') {
    command = `echo "${text}" | pbcopy`;
  } else if (platform === 'win32') {
    command = `powershell Set-Clipboard -Value "${text}"`;
  } else if (platform === 'linux') {
    command = `echo "${text}" | xclip -selection clipboard`;
  } else {
    throw new Error('Unsupported platform: ' + platform);
  }

  execSync(command);
}
