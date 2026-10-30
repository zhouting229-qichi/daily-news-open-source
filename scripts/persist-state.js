import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';

export function persistState({cwd=process.cwd(),branch=process.env.DEFAULT_BRANCH,message='data: update daily news state'}={}){
  const git=(args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(!branch||branch.startsWith('-'))throw Error('DEFAULT_BRANCH is required');
  git(['check-ref-format','refs/heads/'+branch]);
  const state=JSON.parse(readFileSync(cwd+'/.news-state/state.json','utf8'));
  if(state.version!==1||!Array.isArray(state.editions))throw Error('invalid news checkpoint');
  // Fail closed rather than accidentally including unrelated staged files.
  const staged=git(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean);
  if(staged.some(path=>path!=='.news-state/state.json'))throw Error('unrelated staged files; refusing news-state commit');
  git(['config','user.name','github-actions[bot]']);
  git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
  git(['add','-f','--','.news-state/state.json']);
  if(git(['diff','--cached','--name-only']))git(['commit','-m',message]);
  // Always push, even if a previous invocation committed locally and then lost
  // its connection. A rejected push must prevent generation, never be rebased
  // over a newer checkpoint or force-pushed.
  git(['push','origin','HEAD:refs/heads/'+branch]);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{persistState();console.log('News checkpoint persisted.');}
  catch{console.error('Checkpoint persistence failed; no generation may start without a durable reservation.');process.exitCode=1;}
}
