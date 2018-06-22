import {MasterRPC, WorkerRPC} from '../src/libRPC'
import {fork, isMaster} from 'cluster';

if (isMaster) {
    const rpc = new MasterRPC();

    console.log(undefined === void 0);

    rpc.registerFunction('masterfunc', (...params: any[]) => {
        console.log('master', ...params)
    });

    const worker = fork();
    const log = console.log;
    console.log = (...params: any[]) => {
        log('MASTER', ...params);
    };

    setTimeout(async () => {
        try {
            // workerfunc will throw an error after calling masterfunc
            await rpc.remoteCall(worker, 'workerfunc', 'param1', {'obj': 'param2'});
        } catch (e) {
            console.log(e);
        }
    }, 10);
} else {
    const rpc = new WorkerRPC();
    const log = console.log;
    console.log = (...params: any[]) => {
        log('WORKER', ...params);
    };

    rpc.registerFunction('workerfunc',  async (...params: any[]) => {
        console.log('Hello world', ...params);
        await rpc.callOnMaster('masterfunc', ...params);
        throw new Error(params[0]);
    });
}