import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export function createBriefStore(path) {
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS brief_runs(id INTEGER PRIMARY KEY,started_at INTEGER,status TEXT,finished_at INTEGER,error TEXT);
    CREATE TABLE IF NOT EXISTS brief_editions(id INTEGER PRIMARY KEY,run_id INTEGER,generated_at INTEGER,payload TEXT);
    CREATE TABLE IF NOT EXISTS brief_health(id INTEGER PRIMARY KEY CHECK(id=1),checked_at INTEGER,payload TEXT);`);
  if(!db.prepare('PRAGMA table_info(brief_runs)').all().some(c=>c.name==='owner_pid'))db.exec('ALTER TABLE brief_runs ADD COLUMN owner_pid INTEGER');
  const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
  // Opening a read connection must never cancel another process's live run.
  for(const row of db.prepare("SELECT id,owner_pid FROM brief_runs WHERE status='running'").all()){
    if(!alive(row.owner_pid))db.prepare("UPDATE brief_runs SET status='failed',error='previous process interrupted',finished_at=? WHERE id=? AND status='running'").run(Date.now(),row.id);
  }
  return {
    start(now=Date.now()){
      db.exec('BEGIN IMMEDIATE');try{
        const running=db.prepare("SELECT id FROM brief_runs WHERE status='running' LIMIT 1").get();
        if(running)throw new Error('generation already running');
        const id=Number(db.prepare("INSERT INTO brief_runs(started_at,status,owner_pid) VALUES (?,'running',?)").run(now,process.pid).lastInsertRowid);
        db.exec('COMMIT');return id;
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    save(id,edition,now=Date.now()){
      db.exec('BEGIN');try{
        const run=db.prepare('SELECT status,owner_pid FROM brief_runs WHERE id=?').get(id);
        if(run?.status!=='running'||run.owner_pid!==process.pid)throw new Error('generation ownership lost');
        const latest=db.prepare('SELECT payload FROM brief_editions ORDER BY id DESC LIMIT 1').get();
        if(latest&&JSON.parse(latest.payload).cutoff_at>edition.cutoff_at)throw new Error('refusing outdated edition');
        const batch={...edition,generated_at:now,mode:'live'};
        db.prepare('INSERT INTO brief_editions(run_id,generated_at,payload) VALUES (?,?,?)').run(id,now,JSON.stringify(batch));
        db.prepare("UPDATE brief_runs SET status='ready',finished_at=?,error=NULL WHERE id=?").run(now,id);
        db.exec('DELETE FROM brief_editions WHERE id NOT IN (SELECT id FROM brief_editions ORDER BY id DESC LIMIT 30); DELETE FROM brief_runs WHERE id NOT IN (SELECT id FROM brief_runs ORDER BY id DESC LIMIT 100);');
        db.exec('COMMIT');return batch;
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    fail(id,error,now=Date.now()){db.prepare("UPDATE brief_runs SET status='failed',error=?,finished_at=? WHERE id=?").run(String(error).slice(0,180),now,id);},
    health(payload,now=Date.now()){db.prepare('INSERT INTO brief_health(id,checked_at,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,payload=excluded.payload').run(now,JSON.stringify(payload));},
    read(){
      const row=db.prepare('SELECT payload FROM brief_editions ORDER BY generated_at DESC,id DESC LIMIT 1').get();
      const health=db.prepare('SELECT checked_at,payload FROM brief_health WHERE id=1').get();
      return {edition:row?JSON.parse(row.payload):null,last_run:db.prepare('SELECT * FROM brief_runs ORDER BY id DESC LIMIT 1').get()??null,
        health:health?{checked_at:health.checked_at,sources:JSON.parse(health.payload)}:null};
    },
    findEdition(timestamp){const row=db.prepare('SELECT payload FROM brief_editions WHERE generated_at=? ORDER BY id DESC LIMIT 1').get(timestamp);return row?JSON.parse(row.payload):null;},
    archive(){return db.prepare('SELECT payload FROM brief_editions ORDER BY generated_at DESC,id DESC LIMIT 30').all().map(r=>JSON.parse(r.payload)).reverse();},
    restoreArchive(editions){
      db.exec('BEGIN');try{
        for(const e of [...editions].sort((a,b)=>a.generated_at-b.generated_at).slice(-30)){
          if(!Number.isSafeInteger(e.generated_at)||e.generated_at<=0||!Array.isArray(e.articles)||e.mode!=='live')throw new Error('invalid archived edition');
          if(!db.prepare('SELECT id FROM brief_editions WHERE generated_at=?').get(e.generated_at))db.prepare('INSERT INTO brief_editions(run_id,generated_at,payload) VALUES(NULL,?,?)').run(e.generated_at,JSON.stringify(e));
        }
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    close(){db.close();},
  };
}

export async function runGeneration({store,build,now=Date.now}) {
  const id=store.start(now());
  try{
    const result=await build();
    if(!result.articles?.length)throw new Error('no eligible source-supported events');
    return store.save(id,result,now());
  }catch(e){store.fail(id,e.message,now());throw e;}
}
