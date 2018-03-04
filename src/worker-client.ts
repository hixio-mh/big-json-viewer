import {AsyncJsonNodeInfo, AsyncJsonNodeInfoProxy, ClosableJsonNodeInfo, JsonNodeInfo, NodeType} from './parser/json-node-info';
import {BufferJsonParser} from './parser/buffer-json-parser';

export type WorkerCall = (...args) => Promise<any>;

/**
 * Implements the JsonNodeInfo API to call the parser in a web worker.
 */
export class WorkerParserJsonInfo implements ClosableJsonNodeInfo {
  type: NodeType;
  path: string[];
  length: number;


  constructor(private workerCall: WorkerCall, nodeInfo: JsonNodeInfo) {
    this.type = nodeInfo.type;
    this.path = nodeInfo.path;
    this.length = nodeInfo.length;
  }

  getObjectKeys(start?: number, limit?: number): Promise<string[]> {
    return this.workerCall(this.path, 'getObjectKeys', start, limit);
  }

  getByIndex(index: number): Promise<AsyncJsonNodeInfo> {
    return this.workerCall(this.path, 'getByIndex', index)
      .then(info => new WorkerParserJsonInfo(this.workerCall, info));
  }

  getByKey(key: string): Promise<AsyncJsonNodeInfo> {
    return this.workerCall(this.path, 'getByKey', key)
      .then(info => new WorkerParserJsonInfo(this.workerCall, info));
  }

  getByPath(path: string[]): Promise<AsyncJsonNodeInfo> {
    return this.workerCall(this.path, 'getByPath', path)
      .then(info => new WorkerParserJsonInfo(this.workerCall, info));
  }

  getObjectNodes(start?: number, limit?: number): Promise<AsyncJsonNodeInfo[]> {
    return this.workerCall(this.path, 'getObjectNodes', start, limit)
      .then(list => list.map(info => new WorkerParserJsonInfo(this.workerCall, info)));
  }

  getArrayNodes(start?: number, limit?: number): Promise<AsyncJsonNodeInfo[]> {
    return this.workerCall(this.path, 'getArrayNodes', start, limit)
      .then(list => list.map(info => new WorkerParserJsonInfo(this.workerCall, info)));
  }

  getValue(): Promise<any> {
    return this.workerCall(this.path, 'getValue');
  }

  close(): Promise<any> {
    return this.workerCall(this.path, 'closeParser');
  }
}

export class ClosableAsyncJsonNodeInfoProxy extends AsyncJsonNodeInfoProxy implements ClosableJsonNodeInfo {
  constructor(nodeInfo: JsonNodeInfo) {
    super(nodeInfo);
  }

  close() {

  }
}

export class WorkerClient {
  private requestIndex = 0;
  private requestCallbacks = {};
  private worker = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    this.worker = new Worker('./worker/json-parser.worker.ts');
    this.worker.onmessage = msg => {
      if (msg.data && msg.data.resultId && this.requestCallbacks[msg.data.resultId]) {
        const callb = this.requestCallbacks[msg.data.resultId];
        delete this.requestCallbacks[msg.data.resultId];
        callb(msg.data);
      }
    };
    this.worker.onerror = e => console.error(e);
  }

  public call(handler, ...args): Promise<any> {
    return this.callWorker(handler, undefined, ...args);
  }

  public callWorker(handler, transfers = undefined, ...args): Promise<any> {
    return new Promise((resolve, reject) => {
      const resultId = ++this.requestIndex;
      this.requestCallbacks[resultId] = (data) => {
        if (data.error !== undefined) {
          reject(data.error);
          return;
        }
        resolve(data.result);
      };
      this.worker.postMessage({
        handler: handler,
        args: args,
        resultId: resultId
      }, transfers);
    });
  }

}

export function parseWithWorker(data: string | ArrayBuffer): Promise<ClosableJsonNodeInfo> {
  if (!window['Worker']) {
    return new Promise(resolve => {
      resolve(new ClosableAsyncJsonNodeInfoProxy(new BufferJsonParser(data).getRootNodeInfo()));
    });
  }
  const worker = new WorkerClient();
  return worker.callWorker('openParser', [data], data).then(info => {
    const workerCall: WorkerCall = (...args) => {
      return worker.call('callParser', this.parserKey, ...args);
    };
    return new WorkerParserJsonInfo(workerCall, info.node);
  });
}
