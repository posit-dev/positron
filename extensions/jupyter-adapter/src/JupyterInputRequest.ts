/*
 * JupyterInputRequest.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a input_request from the kernel
 * 
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#messages-on-the-stdin-router-dealer-channel
 */
export interface JupyterInputRequest extends JupyterMessageSpec {
    /** The text to show at the prompt */
    prompt: string;

    /** Whether the user is being prompted for a password */
    password: boolean;
}
