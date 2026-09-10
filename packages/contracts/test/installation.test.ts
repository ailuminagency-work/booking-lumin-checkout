import {describe,it,expect} from 'vitest';
import {INSTALLATION_LIMITS,InstallationContractError,createInstallationContracts,parseInstallationOrigin,parseInstallationProfile,parseInstallationRoute,parseInstallationMessage} from '../src/installation';
const id='12345678-1234-4234-8234-123456789abc';
const profile=()=>({profileVersion:'local-v1',rendererOrigin:'https://renderer.test:9442',apiOrigin:'https://api.test:9443',portalOrigin:'https://portal.test:9444',loaderUrl:'https://renderer.test:9442/assets/booking-lumin-loader.'+'a'.repeat(64)+'.js'});
const policy=()=>({schemaVersion:1,installationId:id,mode:'iframe',deploymentProfileVersion:'local-v1',rendererOrigin:profile().rendererOrigin,apiOrigin:profile().apiOrigin,loaderUrl:profile().loaderUrl,currentVersionId:'22345678-1234-4234-8234-123456789abc',targetRevision:1,policyRevision:1,allowedParentOrigins:['https://merchant.test:9441'],enabled:true});
const contracts=()=>createInstallationContracts([profile()]);
const msg=()=>({type:'lumin:init',protocolVersion:1,installationId:id,instanceId:'b'.repeat(32)});
describe('installation profile and trusted registry',()=>{
 it('copies and freezes trusted profile and registry inputs',()=>{const p=profile(),input=[p],c=createInstallationContracts(input);p.rendererOrigin='https://evil.test';input.length=0;const parsed=c.parsePolicy(policy());expect(parsed.rendererOrigin).toBe(profile().rendererOrigin);expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.allowedParentOrigins)).toBe(true);expect(Object.isFrozen(c)).toBe(true);expect(Object.isFrozen(parseInstallationProfile(profile()))).toBe(true);});
 it.each(['http://merchant.test','https://MERCHANT.test','https://merchant.test/','https://merchant.test:443','https://merchant.test/path','https://user:pass@merchant.test','https://merchant.test?x','https://merchant.test#x','null','https://merchant.test.',' https://merchant.test','https://mérchant.test'])('rejects noncanonical origin %s',origin=>expect(()=>parseInstallationOrigin(origin)).toThrow(InstallationContractError));
 it.each(['https://merchant.test','https://merchant.test:9441','https://sub.merchant.test','https://127.0.0.1:9441','https://[::1]:9441'])('accepts exact HTTPS origin %s',origin=>expect(parseInstallationOrigin(origin)).toBe(origin));
 it.each(['','A','1x','a_b','a'.repeat(65)])('rejects profile grammar %s',profileVersion=>expect(()=>parseInstallationProfile({...profile(),profileVersion})).toThrow());
 it('profile max64 accepted only when registered',()=>{const p={...profile(),profileVersion:'a'.repeat(64)};expect(parseInstallationProfile(p).profileVersion).toHaveLength(64);expect(()=>contracts().parsePolicy({...policy(),deploymentProfileVersion:p.profileVersion})).toThrow();expect(createInstallationContracts([p]).parsePolicy({...policy(),deploymentProfileVersion:p.profileVersion}).deploymentProfileVersion).toBe(p.profileVersion);});
 it.each(['rendererOrigin','apiOrigin'])('rejects shared privileged origin %s',key=>expect(()=>parseInstallationProfile({...profile(),[key]:profile().portalOrigin})).toThrow());
 it('rejects shared renderer/API and duplicate registry names',()=>{expect(()=>parseInstallationProfile({...profile(),apiOrigin:profile().rendererOrigin})).toThrow();expect(()=>createInstallationContracts([profile(),profile()])).toThrow();});
 it.each(['?x=1','#x','/','?','#'])('loader extra suffix %s rejects',suffix=>expect(()=>parseInstallationProfile({...profile(),loaderUrl:profile().loaderUrl+suffix})).toThrow());
 it.each(['a'.repeat(63),'A'.repeat(64),'a'.repeat(65),'g'.repeat(64)])('loader hash %s rejects',hash=>expect(()=>parseInstallationProfile({...profile(),loaderUrl:profile().rendererOrigin+'/assets/booking-lumin-loader.'+hash+'.js'})).toThrow());
 it('rejects alternate loader host/path and unknown registry despite valid grammar',()=>{expect(()=>parseInstallationProfile({...profile(),loaderUrl:profile().loaderUrl.replace('renderer.test','evil.test')})).toThrow();expect(()=>parseInstallationProfile({...profile(),loaderUrl:profile().loaderUrl.replace('/assets/','/other/')})).toThrow();expect(()=>contracts().parsePolicy({...policy(),deploymentProfileVersion:'constructor'})).toThrow();});
});
describe('strict public installation policy and safe output',()=>{
 it('only uses renderer origin for hosted URL; loader output requires controller',()=>{const c=contracts();expect(c.composeInstall({...policy(),mode:'hosted',allowedParentOrigins:[]})).toEqual({kind:'hosted',url:profile().rendererOrigin+'/checkout/flow/'+id});const embed=c.composeInstall(policy());expect(embed.kind).toBe('iframe_loader');if(embed.kind==='iframe_loader'){expect(embed.url).toBe(profile().rendererOrigin+'/embed/flow/'+id);expect(embed.requiresCompanionController).toBe(true);expect(embed.html).toContain('data-booking-lumin-installation="'+id+'"');expect(embed.html).toContain(profile().loaderUrl);expect(embed.html).not.toContain('<iframe');expect(embed.html).not.toContain('merchant.test');expect(Object.isFrozen(embed)).toBe(true);}});
 it('disabled policy parses but never produces operational output',()=>{expect(contracts().parsePolicy({...policy(),enabled:false}).enabled).toBe(false);expect(()=>contracts().composeInstall({...policy(),enabled:false})).toThrow();});
 it.each([{schemaVersion:2},{mode:'loader'},{mode:'hosted'},{allowedParentOrigins:[]},{enabled:'true'},{targetRevision:0},{policyRevision:1.5},{targetRevision:9007199254740992},{installationId:id.toUpperCase()},{currentVersionId:'bad'},{extra:'secret'},{rendererOrigin:'https://other.test'},{apiOrigin:'https://other.test'},{loaderUrl:profile().loaderUrl.replace('a'.repeat(64),'b'.repeat(64))}])('rejects malformed/substituted policy %j',change=>expect(()=>contracts().parsePolicy({...policy(),...change})).toThrow());
 it('positive max revisions and parent max20 are supported',()=>{const parents=Array.from({length:20},(_,i)=>`https://m${i}.test`);expect(contracts().parsePolicy({...policy(),targetRevision:Number.MAX_SAFE_INTEGER,policyRevision:Number.MAX_SAFE_INTEGER,allowedParentOrigins:parents}).allowedParentOrigins).toEqual(parents);expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:[...parents,'https://overflow.test']})).toThrow();});
 it.each([profile().rendererOrigin,profile().apiOrigin,profile().portalOrigin])('merchant cannot equal %s',origin=>expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:[origin]})).toThrow());
 it('requires unique exact parent origins and preserves ports/subdomains',()=>{expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:['https://m.test','https://m.test']})).toThrow();expect(contracts().parsePolicy({...policy(),allowedParentOrigins:['https://m.test','https://m.test:9441','https://sub.m.test']}).allowedParentOrigins).toHaveLength(3);});
 it('does not mutate target version or policy revision',()=>{const c=contracts();const old=c.parsePolicy(policy());const next=c.parsePolicy({...policy(),currentVersionId:id,targetRevision:2});expect(old.currentVersionId).not.toBe(next.currentVersionId);expect(old.policyRevision).toBe(next.policyRevision);expect(c.composeInstall(old)).toEqual(c.composeInstall(next));});
});
describe('descriptor-safe untrusted values',()=>{
 it('never invokes object or array getters',()=>{let reads=0;const p=policy();Object.defineProperty(p,'mode',{enumerable:true,get(){reads++;return 'iframe';}});expect(()=>contracts().parsePolicy(p)).toThrow();const a=['https://merchant.test'];Object.defineProperty(a,'0',{enumerable:true,get(){reads++;return 'https://merchant.test';}});expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:a})).toThrow();const m=msg();Object.defineProperty(m,'type',{enumerable:true,get(){reads++;return 'lumin:init';}});expect(()=>parseInstallationMessage(m)).toThrow();expect(reads).toBe(0);});
 it.each([null,[],new Date(),Object.create({mode:'iframe'})])('unsupported policy value rejects',value=>expect(()=>contracts().parsePolicy(value)).toThrow());
 it('rejects symbols, nonenumerable fields, cycles and array extra properties',()=>{const c=contracts();expect(()=>c.parsePolicy({...policy(),[Symbol('secret')]:1})).toThrow();const hidden=policy();Object.defineProperty(hidden,'enabled',{value:true,enumerable:false});expect(()=>c.parsePolicy(hidden)).toThrow();const cycle:any=policy();cycle.allowedParentOrigins=[cycle];expect(()=>c.parsePolicy(cycle)).toThrow();const array:any=['https://m.test'];array.extra='x';expect(()=>c.parsePolicy({...policy(),allowedParentOrigins:array})).toThrow();const sparse=new Array(1);expect(()=>c.parsePolicy({...policy(),allowedParentOrigins:sparse})).toThrow();});
 it('rejects oversized values before serialization, without toJSON effects',()=>{let read=false;const bad={...policy(),allowedParentOrigins:['https://'+'a'.repeat(20000)]};Object.defineProperty(bad,'toJSON',{get(){read=true;throw Error('leak');}});expect(()=>contracts().parsePolicy(bad)).toThrow();expect(read).toBe(false);expect(()=>parseInstallationMessage({...msg(),instanceId:'a'.repeat(1000000)})).toThrow();});
 it('permits plain null-prototype records but copies them',()=>{const p=Object.assign(Object.create(null),policy());const safe=contracts().parsePolicy(p);p.enabled=false;expect(safe.enabled).toBe(true);});
});
describe('canonical routes and bounded message schemas',()=>{
 it.each(['checkout','embed'])('accepts canonical %s route',prefix=>expect(parseInstallationRoute('/'+prefix+'/flow/'+id)).toEqual({mode:prefix==='checkout'?'hosted':'iframe',installationId:id}));
 it.each(['/', '?mode=iframe','#x','/extra'])('rejects route suffix %s',suffix=>expect(()=>parseInstallationRoute('/embed/flow/'+id+suffix)).toThrow());
 it.each(['/embed//flow/'+id,'/embed/flow/'+id.toUpperCase(),'/embed/flow/%31'+id.slice(1),'/index.html','https://renderer.test/embed/flow/'+id,'/other/flow/'+id])('rejects alias %s',route=>expect(()=>parseInstallationRoute(route)).toThrow());
 it.each(['lumin:init','lumin:ready'])('accepts/freeze exact %s',type=>{const value=parseInstallationMessage({...msg(),type});expect(value.type).toBe(type);expect(Object.isFrozen(value)).toBe(true);});
 it.each([320,640,1600])('accepts integer height %s',height=>expect(parseInstallationMessage({...msg(),type:'lumin:resize',height})).toMatchObject({height}));
 it.each([319,1601,Infinity,NaN,640.5,'640px',{}])('rejects height %s',height=>expect(()=>parseInstallationMessage({...msg(),type:'lumin:resize',height})).toThrow());
 it.each([{type:'resize'},{protocolVersion:2},{instanceId:'a'.repeat(31)},{instanceId:'A'.repeat(32)},{installationId:'bad'},{height:640},{token:'secret'}])('rejects message %j',change=>expect(()=>parseInstallationMessage({...msg(),...change})).toThrow());
 it('rejects missing-fourth-group UUID in policy and message',()=>{const bad='12345678-1234-4234-123456789abc';expect(()=>contracts().parsePolicy({...policy(),installationId:bad})).toThrow();expect(()=>parseInstallationMessage({...msg(),installationId:bad})).toThrow();});
 it('freezes lifecycle constants without claiming controller implementation',()=>{expect(Object.isFrozen(INSTALLATION_LIMITS)).toBe(true);expect(INSTALLATION_LIMITS.handshakeMs).toBe(5000);expect(INSTALLATION_LIMITS.initRetryMs).toBe(500);expect(INSTALLATION_LIMITS.maxInitSends).toBe(10);expect(INSTALLATION_LIMITS.policyFetchMs).toBe(2000);expect(INSTALLATION_LIMITS.maxPendingInit).toBe(1);});
});


describe('true end-of-input boundaries',()=>{
 it.each(['\n','\r','\r\n','\u2028','\u2029'])('rejects trailing line terminator %j across all identifiers/routes',suffix=>{
  expect(()=>parseInstallationProfile({...profile(),profileVersion:'local-v1'+suffix})).toThrow();
  expect(()=>parseInstallationProfile({...profile(),loaderUrl:profile().loaderUrl+suffix})).toThrow();
  expect(()=>contracts().parsePolicy({...policy(),installationId:id+suffix})).toThrow();
  expect(()=>contracts().parsePolicy({...policy(),currentVersionId:id+suffix})).toThrow();
  expect(()=>contracts().parsePolicy({...policy(),deploymentProfileVersion:'local-v1'+suffix})).toThrow();
  expect(()=>parseInstallationRoute('/embed/flow/'+id+suffix)).toThrow();
  expect(()=>parseInstallationMessage({...msg(),installationId:id+suffix})).toThrow();
  expect(()=>parseInstallationMessage({...msg(),instanceId:'b'.repeat(32)+suffix})).toThrow();
 });
});


describe('literal wildcard distribution origin denial',()=>{
 it.each(['https://*.example','https://mer*chant.example','https://*','https://a.*.example'])('rejects wildcard %s in origin/profile/parent',origin=>{
  expect(()=>parseInstallationOrigin(origin)).toThrow();
  expect(()=>parseInstallationProfile({...profile(),apiOrigin:origin})).toThrow();
  expect(()=>parseInstallationProfile({...profile(),portalOrigin:origin})).toThrow();
  expect(()=>parseInstallationProfile({...profile(),rendererOrigin:origin,loaderUrl:origin+'/assets/booking-lumin-loader.'+'a'.repeat(64)+'.js'})).toThrow();
  expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:[origin]})).toThrow();
 });
});


describe('reviewed supported-host vocabulary',()=>{
 const maxHost='a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61);
 it.each(['https://localhost','https://xn--bcher-kva.test','https://127.0.0.1','https://[2001:db8::1]:9441','https://'+'a'.repeat(63)+'.test','https://'+maxHost])('accepts bounded supported host %s',origin=>expect(parseInstallationOrigin(origin)).toBe(origin));
 it.each(["https://a'b.test",'https://a;b.test','https://under_score.test','https://-edge.test','https://edge-.test','https://a..test','https://'+'a'.repeat(64)+'.test','https://'+maxHost+'e'])('rejects unsupported host %s',origin=>{
  expect(()=>parseInstallationOrigin(origin)).toThrow();
  expect(()=>parseInstallationProfile({...profile(),apiOrigin:origin})).toThrow();
  expect(()=>contracts().parsePolicy({...policy(),allowedParentOrigins:[origin]})).toThrow();
 });
});
