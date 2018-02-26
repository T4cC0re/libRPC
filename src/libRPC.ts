/**
 * Copyright 2016-2018 Hendrik 'T4cC0re' Meyer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

import {Worker, isMaster, isWorker} from 'cluster';
export {isMaster, isWorker};
import  * as cluster from 'cluster';
import {UUID} from './UUID';
import Process = NodeJS.Process;
import {workers} from "cluster";
import {ChildProcess} from "child_process";

export abstract class RPC {
    protected registered: boolean = false;
    protected functions: IFuncObj;
    protected callbacks: IFuncObj;

    constructor() {
        this.functions = {};
        this.callbacks = {};
        this.registerProcessInternal();
    }

    public async callOnSelf<T>(func: string, ...args: any[]): Promise<T> {
        if (!!this.functions[func]) {
            return this.functions[func].apply({}, args) as T;
        } else {
            throw new Error('Function does not exist!');
        }
    }

    public remoteCall(
        target: Worker|Process|ChildProcess,
        name: string,
        ...args: any[]
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            var uuid = UUID.new();
            this.addCallback(uuid, resolve, reject);
            (target as Process).send(
                {
                    type: 'request',
                    name: name,
                    args: args,
                    uuid: uuid
                }
            );
            uuid = null;
        });
    }

    protected addCallback(uuid: string, resolve: Function, reject: Function) {
        this.callbacks[uuid] = (callState: IRPCResponse) => this.handleCallState(
            callState,
            resolve,
            reject
        );
    }

    protected handleCallState(
        callState: IRPCResponse,
        resolve: Function,
        reject: Function
    ) {
        try {
            if (callState.isError) {
                reject(Object.assign(new Error(), callState.data));
            } else {
                resolve(callState.data);
            }
        } catch (e) {
            reject(e);
        }
    }

    protected async handleRPC(
        data: IRPC,
        worker?: Worker|Process|ChildProcess
    ): Promise<void> {
        //TODO: Make this tidier
        if (typeof data !== 'object') {
            return null;
        }
        var result: any;
        var isError = false;
        //We wanna debug, but don't wanna see shit scrolling by;
        // if(!(data.name == 'getConfig')) {
        //   console.log(`incoming ${data.type}: ${JSON.stringify(data)}`);
        // }
        switch (data.type) {
            case 'request':
                if (!this.functions[(data as IRPCRequest).name]) {
                    result  = new Error(
                        `Function '${(data as IRPCRequest).name}' is not registered on call target!`
                    );
                    isError = true;
                    break;
                }
                try {
                    result = await this.functions[(data as IRPCRequest).name](
                        ...(data as IRPCRequest).args
                    );
                } catch (err) {
                    result  = JSON.parse(
                        JSON.stringify(
                            err,
                            [
                                "message",
                                "arguments",
                                "type",
                                "name",
                                "stack"
                            ]
                        )
                    );
                    isError = true;
                }
                break;
            case 'response':
                try {
                    await this.callbacks[data.uuid](data);
                    delete this.callbacks[data.uuid];
                } catch (e){
                    //For some reason this happens, but has no negative effect...
                }
                data = null;
                return null;
            default:
                return null;
        }
        var responder: any;
        if (isWorker) {
            responder = process;
        } else {
            responder = worker;
        }
        if(!responder){
            return null;
        }
        responder.send(
            {
                type   : 'response',
                isError: isError,
                data   : result,
                name   : data.name,
                uuid   : data.uuid
            } as IRPCResponse
        );
        result    = null;
        isError   = null;
        responder = null;
        return null;
    }

    /**
     * @deprecated calling registerProcess is obsolete
     * @returns {boolean}
     */
    public registerProcess(): boolean {
        console.error('calling xRPC::registerProcess is obsolete');
        return true;
    }

    protected registerProcessInternal(): boolean {
        if (this.registered) {
            return true
        }
        try {
            if (isWorker) {
                process.on('message',
                    (data: IRPC) => this.handleRPC(data));
            } else {
                cluster.on('message',
                    (worker, message) => {
                        // console.log('message:', message);
                        this.handleRPC(message, worker);
                    });
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    public registerFunction(name: string, func: Function) {
        if (!!this.functions[name]) {
            throw new Error('Function already registered!');
        } else if (typeof func !== 'function') {
            throw new Error('Not a function!');
        } else {
            this.functions[name] = func;
        }
    }
}

export class MasterRPC extends RPC {
    constructor() {
        if (!isMaster) {
            // If it is a cluster child process. Note: forked processes are masters!
            throw new Error('Cannot create MasterRPC on non-master process!');
        }
        super();
    }

    public async callOnClient<T>(
        client: Worker,
        func: string,
        ...args: any[]
    ): Promise<T> {
        return this.remoteCall(client, func, ...args) as any as T;
    }

    public async callOnClients<T>(
        func: string,
        ...args: any[]
    ): Promise<T[]> {
        var result: T[] = [];
        // TODO: Catch errors? If so how to signalize that?
        for (var id in workers) {
            result.push(
                await this.callOnClient(
                    workers[id],
                    func,
                    ...args
                )  as any as T
            );
        }
        return result;
    }

    public installHandlerOn(child: Worker|ChildProcess): Worker|ChildProcess {
        try {
            child.on('message', (data: IRPC) => this.handleRPC(data, child));
            return child;
        } catch (e) {
            return null;
        }
    }
}

export class ClientRPC extends RPC {
    constructor() {
        if (!isWorker) {
            throw new Error('Cannot create ClientRPC on non-worker process!');
        }
        super();
    }

    public async callOnMaster<T>(func: string, ...args: any[]): Promise<T> {
        return this.remoteCall(process, func, ...args) as any as T;
    }
}

export class ChildRPC extends RPC {
    constructor() {
        super();
    }

    public async callOnMaster<T>(func: string, ...args: any[]): Promise<T> {
        return this.remoteCall(process, func, ...args) as any as T;
    }

    public registerProcess(): boolean {
        try {
            process.on('message', (data: IRPC) => this.handleRPC(data, process));
            return true;
        } catch (e) {
            return false;
        }
    }
}

declare global {
    interface IFuncObj {
        [funcName: string]: Function;
    }

    interface IRPC {
        type: 'request'|'response'
        uuid: string
        name: string
    }

    interface IRPCRequest extends IRPC {
        type: 'request'
        args?: any[]
    }

    interface IRPCResponse extends IRPC {
        type: 'response'
        isError?: boolean
        data: any
    }
}
