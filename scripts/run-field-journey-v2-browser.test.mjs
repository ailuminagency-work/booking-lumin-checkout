import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldJourneyV2Browser} from './run-field-journey-v2-browser.mjs';
function fixture(platform='linux') {
 const root=platform==='win32'?'C:\\work\\repo':'/work/repo';
 const env={FIELD_JOURNEY_V2_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:platform==='win32'?'local':'github-ci',GITHUB_ACTIONS:'true'};
 let manifest={browsers:[{name:'chromium',revision:'1243'}]},pkg={name:'playwright-core',version:'1.63.0'};
 const reads=[];const bytes=p=>Buffer.from(JSON.stringify(p.endsWith('browsers.json')?manifest:pkg));
 const fs={async lstat(p){const file=/package\.json$|browsers\.json$|chrome(?:\.exe)?$/.test(p);return {size:file?bytes(p).length:0,mode:0o755,isSymbolicLink:()=>false,isDirectory:()=>!file,isFile:()=>file};},async realpath(p){return p;},async readFile(p){reads.push(p);return bytes(p);}};
 return {root,platform,arch:'x64',env,fs,reads,setManifest(v){manifest=v;},setPackage(v){pkg=v;}};
}
const rejects=value=>assert.rejects(fieldJourneyV2Browser(value),{message:'CONFIGURATION_FAILED'});
test('fixed Linux full-browser path matches accepted installer cache',async()=>{const f=fixture();assert.equal(await fieldJourneyV2Browser(f),'/work/repo/.cache/mode-runtime-playwright/chromium-1243/chrome-linux64/chrome');assert.equal(f.reads.length,2);});
test('Windows local resolution preserves existing sibling cache and case tolerance',async()=>{const f=fixture('win32');f.fs.realpath=async p=>p.toUpperCase();assert.equal(await fieldJourneyV2Browser(f),'C:\\work\\mode-session-http\\.cache\\mode-runtime-playwright\\chromium-1243\\chrome-win64\\chrome.exe');});
test('profile, platform, CI, approval and architecture mismatches fail before files',async()=>{
 for(const override of [{platform:'darwin'},{arch:'arm64'},{env:{FIELD_JOURNEY_V2_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'local'}},{env:{FIELD_JOURNEY_V2_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'false'}},{env:{TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'}},{platform:'win32',env:{FIELD_JOURNEY_V2_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'}}]){const f=fixture();await rejects({...f,...override});assert.equal(f.reads.length,0);}
});
test('inherited browser paths and executable overrides never select another binary',async()=>{const f=fixture();Object.assign(f.env,{PLAYWRIGHT_BROWSERS_PATH:'/foreign',CHROME_PATH:'/foreign/chrome',PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:'/foreign/browser'});assert.equal(await fieldJourneyV2Browser(f),'/work/repo/.cache/mode-runtime-playwright/chromium-1243/chrome-linux64/chrome');});
test('manifest missing, foreign or duplicate pinned Chromium rejects',async()=>{for(const browsers of [[],[{name:'chromium',revision:'999'}],[{name:'chromium',revision:1243}],[{name:'chromium',revision:'1243'},{name:'chromium',revision:'1243'}]]){const f=fixture();f.setManifest({browsers});await rejects(f);}const f=fixture();f.setPackage({name:'playwright-core',version:'1.62.0'});await rejects(f);});
test('missing executable and malformed manifest fail with finite error',async()=>{const f=fixture(),lstat=f.fs.lstat;f.fs.lstat=async p=>{if(p.endsWith('/chrome'))throw Error('private file details');return lstat(p);};await rejects(f);const bad=fixture();bad.fs.readFile=async()=>Buffer.from('bad');await rejects(bad);});
test('symlink file or any ancestor is rejected without foreign reads',async()=>{for(const badPath of ['/work/repo/.cache','/work/repo/.cache/mode-runtime-playwright/chromium-1243','/work/repo/.cache/mode-runtime-playwright/chromium-1243/chrome-linux64/chrome','/work/repo/node_modules']){const f=fixture(),lstat=f.fs.lstat;f.fs.lstat=async p=>({...await lstat(p),isSymbolicLink:()=>p===badPath});await rejects(f);}});
test('Linux canonical paths are case-sensitive and reject realpath redirection',async()=>{for(const redirect of [p=>p.toUpperCase(),p=>p.includes('.cache')?'/foreign':p]){const f=fixture();f.fs.realpath=async p=>redirect(p);await rejects(f);}});
test('directories, nonexecutables and oversized manifests are rejected',async()=>{for(const mode of ['directory','nonexecuting','oversized']){const f=fixture(),lstat=f.fs.lstat;f.fs.lstat=async p=>{const stat=await lstat(p);if(p.endsWith('/chrome'))return {...stat,isFile:()=>mode!=='directory',mode:mode==='nonexecuting'?0o644:0o755};if(mode==='oversized'&&p.endsWith('browsers.json'))return {...stat,size:1048577};return stat;};await rejects(f);}});
