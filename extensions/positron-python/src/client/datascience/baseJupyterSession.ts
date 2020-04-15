// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import { JSONObject } from '@phosphor/coreutils';
import { Slot } from '@phosphor/signaling';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Event, EventEmitter } from 'vscode';
import { ServerStatus } from '../../datascience-ui/interactive-common/mainState';
import { traceError } from '../common/logger';
import { waitForPromise } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { sendTelemetryEvent } from '../telemetry';
import { Telemetry } from './constants';
import { JupyterWebSockets } from './jupyter/jupyterWebSocket';
import { JupyterKernelPromiseFailedError } from './jupyter/kernels/jupyterKernelPromiseFailedError';
import { LiveKernelModel } from './jupyter/kernels/types';
import { IJupyterKernelSpec, IJupyterSession, KernelSocketInformation } from './types';

export type ISession = Session.ISession & {
    /**
     * Whether this is a remote session that we attached to.
     *
     * @type {boolean}
     */
    isRemoteSession?: boolean;
};

/**
 * Exception raised when starting a Jupyter Session fails.
 *
 * @export
 * @class JupyterSessionStartError
 * @extends {Error}
 */
export class JupyterSessionStartError extends Error {
    constructor(originalException: Error) {
        super(originalException.message);
        this.stack = originalException.stack;
        sendTelemetryEvent(Telemetry.StartSessionFailedJupyter);
    }
}

export abstract class BaseJupyterSession implements IJupyterSession {
    protected get session(): ISession | undefined {
        return this._session;
    }
    protected set session(session: ISession | undefined) {
        const oldSession = this._session;
        this._session = session;
        // If we have a new session, then emit the new kernel connection information.
        if (session && oldSession !== session) {
            const socket = JupyterWebSockets.get(session.kernel.id);
            if (!socket) {
                traceError(`Unable to find WebSocket connetion assocated with kerne ${session.kernel.id}`);
                this._kernelSocket.next(undefined);
                return;
            }
            this._kernelSocket.next({
                options: {
                    clientId: session.kernel.clientId,
                    id: session.kernel.id,
                    model: { ...session.kernel.model },
                    userName: session.kernel.username
                },
                socket: socket
            });
        }
    }
    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket;
    }
    private get jupyterLab(): undefined | typeof import('@jupyterlab/services') {
        if (!this._jupyterLab) {
            // tslint:disable-next-line:no-require-imports
            this._jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
        }
        return this._jupyterLab;
    }

    public get onSessionStatusChanged(): Event<ServerStatus> {
        if (!this.onStatusChangedEvent) {
            this.onStatusChangedEvent = new EventEmitter<ServerStatus>();
        }
        return this.onStatusChangedEvent.event;
    }

    public get status(): ServerStatus {
        return this.getServerStatus();
    }

    public get isConnected(): boolean {
        return this.connected;
    }
    protected onStatusChangedEvent: EventEmitter<ServerStatus> = new EventEmitter<ServerStatus>();
    protected statusHandler: Slot<ISession, Kernel.Status>;
    protected connected: boolean = false;
    private _session: ISession | undefined;
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private _jupyterLab?: typeof import('@jupyterlab/services');
    constructor() {
        this.statusHandler = this.onStatusChanged.bind(this);
    }
    public dispose(): Promise<void> {
        return this.shutdown();
    }
    // Abstracts for each Session type to implement
    public abstract async shutdown(): Promise<void>;
    public abstract async restart(timeout: number): Promise<void>;
    public abstract async changeKernel(kernel: IJupyterKernelSpec | LiveKernelModel, timeoutMS: number): Promise<void>;
    public abstract async waitForIdle(timeout: number): Promise<void>;

    public async interrupt(timeout: number): Promise<void> {
        if (this.session && this.session.kernel) {
            // Listen for session status changes
            this.session.statusChanged.connect(this.statusHandler);

            await this.waitForKernelPromise(
                this.session.kernel.interrupt(),
                timeout,
                localize.DataScience.interruptingKernelFailed()
            );
        }
    }

    public requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> | undefined {
        return this.session && this.session.kernel
            ? this.session.kernel.requestExecute(content, disposeOnDone, metadata)
            : undefined;
    }

    public requestInspect(
        content: KernelMessage.IInspectRequestMsg['content']
    ): Promise<KernelMessage.IInspectReplyMsg | undefined> {
        return this.session && this.session.kernel
            ? this.session.kernel.requestInspect(content)
            : Promise.resolve(undefined);
    }

    public requestComplete(
        content: KernelMessage.ICompleteRequestMsg['content']
    ): Promise<KernelMessage.ICompleteReplyMsg | undefined> {
        return this.session && this.session.kernel
            ? this.session.kernel.requestComplete(content)
            : Promise.resolve(undefined);
    }

    public sendInputReply(content: string) {
        if (this.session && this.session.kernel) {
            // tslint:disable-next-line: no-any
            this.session.kernel.sendInputReply({ value: content, status: 'ok' });
        }
    }

    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ) {
        if (this.session && this.session.kernel) {
            this.session.kernel.registerCommTarget(targetName, callback);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    public sendCommMessage(
        buffers: (ArrayBuffer | ArrayBufferView)[],
        content: { comm_id: string; data: JSONObject; target_name: string | undefined },
        // tslint:disable-next-line: no-any
        metadata: any,
        // tslint:disable-next-line: no-any
        msgId: any
    ): Kernel.IShellFuture<
        KernelMessage.IShellMessage<'comm_msg'>,
        KernelMessage.IShellMessage<KernelMessage.ShellMessageType>
    > {
        if (this.session && this.session.kernel && this.jupyterLab) {
            const shellMessage = this.jupyterLab.KernelMessage.createMessage<KernelMessage.ICommMsgMsg<'shell'>>({
                // tslint:disable-next-line: no-any
                msgType: 'comm_msg',
                channel: 'shell',
                buffers,
                content,
                metadata,
                msgId,
                session: this.session.kernel.clientId,
                username: this.session.kernel.username
            });

            return this.session.kernel.sendShellMessage(shellMessage, false, true);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    public requestCommInfo(
        content: KernelMessage.ICommInfoRequestMsg['content']
    ): Promise<KernelMessage.ICommInfoReplyMsg> {
        if (this.session?.kernel) {
            return this.session.kernel.requestCommInfo(content);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }
    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.registerMessageHook(msgId, hook);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.removeMessageHook(msgId, hook);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    private getServerStatus(): ServerStatus {
        if (this.session) {
            switch (this.session.kernel.status) {
                case 'busy':
                    return ServerStatus.Busy;
                case 'dead':
                    return ServerStatus.Dead;
                case 'idle':
                case 'connected':
                    return ServerStatus.Idle;
                case 'restarting':
                case 'autorestarting':
                case 'reconnecting':
                    return ServerStatus.Restarting;
                case 'starting':
                    return ServerStatus.Starting;
                default:
                    return ServerStatus.NotStarted;
            }
        }

        return ServerStatus.NotStarted;
    }

    private async waitForKernelPromise(
        kernelPromise: Promise<void>,
        timeout: number,
        errorMessage: string
    ): Promise<void | null> {
        // Wait for this kernel promise to happen
        try {
            return await waitForPromise(kernelPromise, timeout);
        } catch (e) {
            if (!e) {
                // We timed out. Throw a specific exception
                throw new JupyterKernelPromiseFailedError(errorMessage);
            }
            throw e;
        }
    }

    private onStatusChanged(_s: Session.ISession) {
        if (this.onStatusChangedEvent) {
            this.onStatusChangedEvent.fire(this.getServerStatus());
        }
    }
}
