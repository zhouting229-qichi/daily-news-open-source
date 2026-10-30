export function cloudDecision({now=Date.now(),edition=null,attempts=null,requiredRevision=0}){
  const day=new Date(now).toISOString().slice(0,10),count=attempts?.day===day?attempts.count:0;
  const generated=!!edition&&edition.generated_at>=Math.floor(now/86400000)*86400000&&(edition.revision??0)>=requiredRevision;
  return {day,count,generate:!generated&&count<3,reason:generated?'already-generated':count>=3?'daily-attempt-limit':'due'};
}
export async function runCloudCycle({now=Date.now(),state={},collect,generate,save,requiredRevision=0}){
  const decision=cloudDecision({now,edition:state.edition,attempts:state.attempts,requiredRevision});
  const next={...state,attempts:{day:decision.day,count:decision.count}};
  let error=null;
  try{
    next.health=await collect();
    if(decision.generate){
      next.attempts.count++;
      next.last_run={status:'running',started_at:now};
      // A runner can disappear at any await. Persist the reservation remotely
      // before starting billable work so cancellation cannot reset the limit.
      await save(next,{reservation:true});
      next.edition=await generate();
      next.editions=[...(state.editions??[]),next.edition].filter((e,i,all)=>all.findIndex(x=>x.generated_at===e.generated_at)===i).sort((a,b)=>a.generated_at-b.generated_at).slice(-30);
      next.last_run={status:'ready',started_at:now,finished_at:Date.now()};
    }
  }catch(e){error=e.message;next.last_run={status:'failed',started_at:now,finished_at:Date.now(),error:String(error).slice(0,180)};}
  await save(next);
  return {ok:!error,state:next,generated:decision.generate&&!error,reason:decision.reason,error};
}
