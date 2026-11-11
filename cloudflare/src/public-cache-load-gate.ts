import {ReadBudgetError} from './read-budget.ts';

// Buffer short cold-cache bursts before they contend for the shared D1 ledger.
// Warm reads bypass this queue. No reservation, SQL or storage write is made
// until a slot opens; the normal read-budget guard still admits every query.
export const PUBLIC_CACHE_LOAD_POLICY=Object.freeze({concurrent:2,queued:64,waitMs:5000});
interface Waiter {resolve:()=>void;reject:(error:ReadBudgetError)=>void;timer:ReturnType<typeof setTimeout>;deadline:number;}

export class PublicCacheLoadGate {
  private active=0;
  private queue:Waiter[]=[];
  private policy:{concurrent:number;queued:number;waitMs:number};
  constructor(policy:{concurrent:number;queued:number;waitMs:number}=PUBLIC_CACHE_LOAD_POLICY) {this.policy=policy;}
  private acquire():Promise<void> {
    if(this.active<this.policy.concurrent){this.active++;return Promise.resolve();}
    if(this.queue.length>=this.policy.queued)return Promise.reject(new ReadBudgetError('public_cache_load_queue_full',2));
    return new Promise((resolve,reject)=>{
      const waiter:Waiter={resolve,reject,deadline:Date.now()+this.policy.waitMs,timer:setTimeout(()=>{
        const index=this.queue.indexOf(waiter);
        if(index!==-1){this.queue.splice(index,1);reject(new ReadBudgetError('public_cache_load_queue_timeout',2));}
      },this.policy.waitMs)};
      this.queue.push(waiter);
    });
  }
  private release():void {
    for(let waiter;(waiter=this.queue.shift());) {
      clearTimeout(waiter.timer);
      if(waiter.deadline<=Date.now()){waiter.reject(new ReadBudgetError('public_cache_load_queue_timeout',2));continue;}
      waiter.resolve();return;
    }
    this.active--;
  }
  async run<T>(load:()=>Promise<T>):Promise<T> {
    await this.acquire();
    try {return await load();}finally{this.release();}
  }
}
