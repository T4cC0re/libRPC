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

    public abstract async callOnMaster<T>(func: string, ...args: any[]): Promise<T>;

    public remoteCall(
        target: Worker|Process|ChildProcess,
        name: string,
        ...args: any[]
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            let uuid = UUID.new();
            this.addCallback(uuid, resolve, reject);
            (target as Process).send(
                {
                    jsonrpc: '2.0',
                    method: name,
                    params: args,
                    id: uuid
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
            if (callState.error) {
                reject(Object.assign(new Error(callState.error.message), callState.error.data || {}));
            } else {
                resolve(callState.result);
            }
        } catch (e) {
            reject(e);
        }
    }

    protected async handleRPC(
        data: IRPC,
        caller?: Worker|Process|ChildProcess
    ): Promise<void> {
        //TODO: Make this tidier
        if (typeof data !== 'object') {
            console.error('data is not an object');
            return null;
            // TODO: Send error
        }
        if (data.jsonrpc !== '2.0') {
            console.error('data.jsonrpc !== \'2.0\'');
            return null;
            // TODO: Send error
        }
        let result: any;
        let isError = false;
        if ((data as IRPCRequest).method != undefined && typeof (data as IRPCRequest).method === 'string') {
            if (!this.functions[(data as IRPCRequest).method]) {
                result  = new Error(
                    `Function '${(data as IRPCRequest).method}' is not registered on call target!`
                );
                isError = true;
            } else {
                try {
                    result = await this.functions[(data as IRPCRequest).method](
                        ...(data as IRPCRequest).params
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
            }
            if(!caller){
                caller = process;
            }
            let response: IRPCResponse = {
                id: data.id,
                jsonrpc: '2.0',
            };
            if(isError) {
                response.error = { code: 0,
                    message: (result as Error).message,
                    data: result
                }
            } else {
                response.result = result || null
            }
            (caller as Process).send(
                response
            );
            result    = null;
            isError   = null;
        } else {
            try {
                await this.callbacks[data.id](data);
                delete this.callbacks[data.id];
            } catch (e){
                //For some reason this happens, but has no negative effect...
            }
        }
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

    public async callOnMaster<T>(func: string, ...args: any[]): Promise<T> {
        return this.callOnSelf<T>(func, ...args);
    }

    public async callOnClient<T>(
        client: Worker,
        func: string,
        ...args: any[]
    ): Promise<T> {
        return this.remoteCall(client, func, ...args) as any as T;
    }

    /**
     * @deprecated please use callOnWorkers instead
     * @param {string} func
     * @param args
     * @returns {Promise<T[]>}
     */
    public async callOnClients<T>(
        func: string,
        ...args: any[]
    ): Promise<T[]> {
        console.error('MasterRPC::callOnClients is deprecated; Please use MasterRPC::callOnWorkers instead');
        return this.callOnWorkers<T>(func, ...args);
    }

    public async callOnWorkers<T>(
        func: string,
        ...args: any[]
    ): Promise<T[]> {
        let result: T[] = [];
        // TODO: Catch errors? If so how to signalize that?
        for (let id in workers) {
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

    /**
     * Note: Do not call on workers (forks of cluster) but do in child processes (regular forks)
     * @param {"child_process".ChildProcess} child
     * @returns {"child_process".ChildProcess}
     */
    public installHandlerOn(child: ChildProcess): ChildProcess {
        try {
            child.on('message', (data: IRPC) => this.handleRPC(data, child));
            return child;
        } catch (e) {
            return null;
        }
    }
}

export class WorkerRPC extends RPC {
    constructor() {
        if (!isWorker) {
            throw new Error('Cannot create WorkerRPC on non-worker process!');
        }
        super();
    }

    public async callOnMaster<T>(func: string, ...args: any[]): Promise<T> {
        return this.remoteCall(process, func, ...args) as any as T;
    }
}

/**
 * @deprecated Please use WorkerRPC instead!
 */
export class ClientRPC extends WorkerRPC {
    constructor() {
        console.error('MasterRPC::ClientRPC is deprecated; Please use MasterRPC::WorkerRPC instead');
        super();
    }
}

export class ChildRPC extends RPC {
    constructor() {
        super();
    }

    public async callOnMaster<T>(func: string, ...args: any[]): Promise<T> {
        return this.remoteCall(process, func, ...args) as any as T;
    }

    /**
     * @deprecated calling registerProcess is obsolete
     * @returns {boolean}
     */
    public registerProcess(): boolean {
        console.error('calling ChildRPC::registerProcess is obsolete');
        return true;
    }

    protected registerProcessInternal(): boolean {
        if (this.registered) {
            return true
        }
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
        jsonrpc: '2.0'
        id: string
    }

    interface IRPCRequest extends IRPC {
        method: string
        params: any[]|any
    }

    interface IRPCResponse extends IRPC {
        error?: IRPCError
        result?: any
    }

    interface IRPCError {
        code: number
        message: string
        data: any
    }
}
