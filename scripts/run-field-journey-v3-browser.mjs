import * as filesystem from 'node:fs/promises';
import {posix,win32} from 'node:path';

/** Resolve an already installed, locked browser. This helper never installs or launches. */
export async function fieldJourneyV3Browser({root,platform=process.platform,arch=process.arch,env=process.env,fs=filesystem}) {
  const fail=()=>{throw Error('CONFIGURATION_FAILED');};
  try {
    const local=platform==='win32'&&env.TEXT_DRAFT_TEST_PROFILE==='local';
    const ci=platform==='linux'&&arch==='x64'&&env.TEXT_DRAFT_TEST_PROFILE==='github-ci'&&env.GITHUB_ACTIONS==='true';
    if(env.FIELD_JOURNEY_V3_APPROVED!=='1'||(!local&&!ci))return fail();
    const path=platform==='win32'?win32:posix;
    if(typeof root!=='string'||!path.isAbsolute(root))return fail();
    root=path.resolve(root);
    const equal=(a,b)=>local?a.toLowerCase()===b.toLowerCase():a===b;
    async function canonical(target,file=false) {
      const chain=[];let current=path.dirname(target);
      while(true){chain.push(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}
      for(const dir of chain.reverse()) {const stat=await fs.lstat(dir);if(stat.isSymbolicLink()||!stat.isDirectory()||!equal(await fs.realpath(dir),dir))return fail();}
      const stat=await fs.lstat(target);
      if(stat.isSymbolicLink()||!(file?stat.isFile():stat.isDirectory())||!equal(await fs.realpath(target),target))return fail();
      return stat;
    }
    async function json(relative) {
      const file=path.resolve(root,relative),stat=await canonical(file,true);
      if(!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>1048576)return fail();
      const bytes=await fs.readFile(file);if(bytes.length!==stat.size)return fail();
      return JSON.parse(bytes.toString('utf8'));
    }
    const pkg=await json('node_modules/playwright-core/package.json');
    const manifest=await json('node_modules/playwright-core/browsers.json');
    if(pkg.name!=='playwright-core'||pkg.version!=='1.63.0'||!Array.isArray(manifest.browsers))return fail();
    const entries=manifest.browsers.filter(entry=>entry?.name==='chromium');
    if(entries.length!==1||entries[0].revision!=='1243')return fail();
    const executablePath=local
      ?path.resolve(root,'../mode-session-http/.cache/mode-runtime-playwright/chromium-1243/chrome-win64/chrome.exe')
      :path.resolve(root,'.cache/mode-runtime-playwright/chromium-1243/chrome-linux64/chrome');
    const stat=await canonical(executablePath,true);
    if(ci&&(stat.mode&0o111)===0)return fail();
    return executablePath;
  }catch{return fail();}
}
