import {PublicCacheRevision,type RevisionWriteInput,type RevisionWriteMethod,type RevisionCompletion} from './public-cache-revision.ts';
import {ReadBudgetError} from './read-budget.ts';

type Value=string|number|null;
interface Store {
  sql:{exec<T extends Record<string,Value>=Record<string,Value>>(query:string,...values:Value[]):{toArray():T[];one():T;rowsWritten?:number}};
  transactionSync<T>(callback:()=>T):T;
}
export interface RevisionLifecycleBudget {
  credits():Promise<{id:string;cost:number}[]>;
  reserve(id:string,cost:number,completion:number):Promise<boolean>;
  complete(id:string):Promise<boolean>;
}

// Keep planning, the asynchronous grant, and application in one local queue.
// A second coordinator RPC cannot add selectors or expire a ticket between
// calculating its storage cost and committing the budgeted transaction.
export class BudgetedPublicRevision {
  private tail:Promise<void>=Promise.resolve();
  private revision?:PublicCacheRevision;
  private store:Store;
  private metered:Store;
  private reserve:(cost:number)=>Promise<boolean>;
  private allowance=0;
  private lifecycle?:RevisionLifecycleBudget;
  private clock:()=>number;
  private nextCreditSweep=0;
  constructor(store:Store,reserve:(cost:number)=>Promise<boolean>,lifecycle?:RevisionLifecycleBudget,clock=Date.now) {
    this.store=store;this.reserve=reserve;
    this.lifecycle=lifecycle;this.clock=clock;
    this.metered={transactionSync:callback=>store.transactionSync(callback),sql:{exec:<T extends Record<string,Value>>(query:string,...values:Value[])=>{
      const cursor=store.sql.exec<T>(query,...values),rows=cursor.toArray();
      if(typeof cursor.rowsWritten==='number') {
        this.allowance-=cursor.rowsWritten;
        if(this.allowance<0)throw new Error('Public revision storage cost exceeded its grant: '+query.split(/\s+/).slice(0,6).join(' '));
      }
      return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw new Error('Expected one public revision row');return rows[0];}};
    }}};
  }
  private async grant(cost:number):Promise<boolean> {
    if(!cost)return true;
    if(cost>512)return false;
    try{return await this.reserve(cost);}catch{return false;}
  }
  private async acknowledge(key:string) {try{await this.lifecycle!.complete(key);}catch{this.nextCreditSweep=0;/* Unknown acknowledgement retains its conservative hold. */}}
  private async cleanup(now:number) {
    if(!this.lifecycle)return;
    const tickets=this.revision!.completionTickets(),expired=tickets.filter(ticket=>ticket.expires<=now);
    if(!expired.length&&now<this.nextCreditSweep)return;
    const credits=new Map((await this.lifecycle.credits()).map(row=>[row.id,row.cost]));
    this.nextCreditSweep=now+60_000;
    const known=new Set(tickets.map(ticket=>ticket.key));
    // A crash between prepayment and ticket creation (or after successful SQL
    // completion) can leave an orphan hold. Acknowledging cannot refund usage.
    for(const key of credits.keys())if(!known.has(key))await this.acknowledge(key);
    for(const ticket of expired)await this.complete(ticket,credits.get(ticket.key));
  }
  private async complete(ticket:RevisionCompletion,credit?:number) {
    if(credit===undefined)credit=(await this.lifecycle!.credits()).find(row=>row.id===ticket.key)?.cost;
    if((credit??0)<ticket.cost) {
      // Pre-existing deployed tickets have no promise. Acquire their bounded
      // completion once; never admit new work while old dirty state is stuck.
      if(!await this.lifecycle!.reserve(ticket.key,0,ticket.cost))throw new ReadBudgetError('do_auxiliary_storage_budget');
    }
    this.allowance=ticket.cost;
    if(ticket.scoped)this.revision!.finishScoped(ticket.id);else this.revision!.finish(ticket.id);
    await this.acknowledge(ticket.key);
  }
  async run<T>(method:RevisionWriteMethod,input:RevisionWriteInput,apply:(revision:PublicCacheRevision,now:number,maintain:boolean)=>T,readOnly=false):Promise<T> {
    const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try {
      if(!this.revision) {
        const cost=PublicCacheRevision.initializationCost(this.store),grantDay=Math.floor(this.clock()/86400000);
        if(!await this.grant(cost))throw new ReadBudgetError('do_auxiliary_storage_budget');
        if(cost&&Math.floor(this.clock()/86400000)!==grantDay)throw new ReadBudgetError('do_auxiliary_storage_budget');
        this.allowance=cost;this.revision=new PublicCacheRevision(this.metered);
      }
      const now=this.clock();
      if(this.lifecycle) {
        try{await this.cleanup(now);}catch(error){if(!readOnly)throw error;this.allowance=0;return apply(this.revision,now,false);}
        if(method==='finish'||method==='finishScoped') {
          const ticket=this.revision.completionTickets().find(ticket=>ticket.id===input.id&&ticket.scoped===(method==='finishScoped'));
          if(ticket)await this.complete(ticket);
          this.allowance=0;return apply(this.revision,now,false);
        }
      }
      const planned=this.revision.writeCost(method,input,now),completion=this.lifecycle?this.revision.futureCompletionCost(method,input,now):0;
      const key=(method==='begin'?'legacy-':'scoped-')+(input.id||'');
      let allowed:boolean;
      try{allowed=completion&&planned?await this.lifecycle!.reserve(key,planned,completion):await this.grant(planned);}
      catch(error){this.nextCreditSweep=0;throw error;}
      // Grants cross an asynchronous RPC boundary. Recheck both write cost and
      // lease eligibility against the actual application time, never the time
      // before a slow coordinator response.
      const appliedAt=this.clock(),current=this.revision.writeCost(method,input,appliedAt);
      const currentCompletion=this.lifecycle?this.revision.futureCompletionCost(method,input,appliedAt):0;
      if(!allowed||current>planned||currentCompletion>completion||planned&&Math.floor(appliedAt/86400000)!==Math.floor(now/86400000)) {
        if(!readOnly)throw new ReadBudgetError('do_auxiliary_storage_budget');
        this.allowance=0;
        return apply(this.revision,appliedAt,false);
      }
      this.allowance=planned;
      const result=apply(this.revision,appliedAt,true);
      // A conflicting/no-op claim creates no ticket, and therefore needs no
      // future hold. Actual precharged rows remain spent conservatively.
      if(completion&&!this.revision.completionTickets().some(ticket=>ticket.key===key))await this.acknowledge(key);
      return result;
    } finally {release();}
  }
}
