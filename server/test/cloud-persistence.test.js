import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {persistState} from '../../scripts/persist-state.js';

function repository(){
  const root=mkdtempSync(join(tmpdir(),'news-checkpoint-')),cwd=join(root,'checkout'),remote=join(root,'remote.git');
  mkdirSync(cwd);
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--bare',remote);git('init','--initial-branch=main');
  git('config','user.name','Test');git('config','user.email','test@example.invalid');
  writeFileSync(join(cwd,'README.md'),'Test');git('add','README.md');git('commit','-m','init');
  git('remote','add','origin',remote);git('push','origin','main');
  mkdirSync(join(cwd,'.news-state'));
  writeFileSync(join(cwd,'.news-state/state.json'),JSON.stringify({version:1,editions:[],attempts:{day:'2026-10-28',count:3}}));
  return {root,cwd,git};
}

test('reservation reaches the remote and repeat persistence is idempotent',()=>{
  const {root,cwd,git}=repository();
  try{
    persistState({cwd,branch:'main'});
    const head=git('rev-parse','HEAD');
    assert.equal(JSON.parse(git('--git-dir',join(root,'remote.git'),'show','main:.news-state/state.json')).attempts.count,3);
    persistState({cwd,branch:'main'});
    assert.equal(git('rev-parse','HEAD'),head);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('checkpoint commit refuses unrelated staged files and a failed remote cannot report success',()=>{
  const {root,cwd,git}=repository();
  try{
    writeFileSync(join(cwd,'unrelated.txt'),'Do not publish');git('add','unrelated.txt');
    assert.throws(()=>persistState({cwd,branch:'main'}),/unrelated staged files/);
    git('reset','--','unrelated.txt');
    git('remote','set-url','origin',join(root,'missing.git'));
    assert.throws(()=>persistState({cwd,branch:'main'}));
  }finally{rmSync(root,{recursive:true,force:true});}
});
