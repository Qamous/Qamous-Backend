import {DurableObject} from 'cloudflare:workers';
import {ReadBudgetLedger,type Reservation} from './read-budget-ledger';

export class QamousReadBudget extends DurableObject<Env> {
  private ledger:ReadBudgetLedger;
  constructor(ctx:DurableObjectState,env:Env) {
    super(ctx,env);
    this.ledger=new ReadBudgetLedger(ctx.storage,{day:env.READ_BUDGET_BOOTSTRAP_DAY,rows:Number(env.READ_BUDGET_BOOTSTRAP_ROWS),cacheDay:env.PUBLIC_CACHE_WRITE_BOOTSTRAP_DAY,cacheRows:Number(env.PUBLIC_CACHE_WRITE_BOOTSTRAP_ROWS)});
  }
  reserve(input:Reservation) {return this.ledger.reserve(input);}
  settle(id:string,actual:number|null,writes=0) {return this.ledger.settle(id,actual,writes);}
  reservePublicCacheWrites(cost:number,tier:'public'|'essential') {return this.ledger.reservePublicCacheWrites(cost,tier);}
  status() {return this.ledger.status();}
  // Only Worker bindings can call this RPC. There is no public API route.
  // The importer's existing protected admin interface exposes upward reconcile.
  reconcile(input:{day:string;rowsRead:number;observedAt:string}) {return this.ledger.reconcile(input);}
}
