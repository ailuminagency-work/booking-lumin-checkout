import { expect,it,vi,afterEach } from 'vitest';
import {createFieldJourneyV3Environment,fieldJourneyV3Configuration} from './field-journey-v3-environment';
const constructors=vi.hoisted(()=>({Pool:vi.fn(function(){throw Error('UNEXPECTED_DATABASE_CONSTRUCTOR');}),Client:vi.fn(function(){throw Error('UNEXPECTED_DATABASE_CONSTRUCTOR');})}));
vi.mock('pg',()=>constructors);
afterEach(()=>{expect(constructors.Pool).not.toHaveBeenCalled();expect(constructors.Client).not.toHaveBeenCalled();});
const env={FIELD_JOURNEY_V3_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32)};
it('requires explicit journey approval before creating any database clients',async()=>{await expect(createFieldJourneyV3Environment({})).rejects.toThrow('FIELD_JOURNEY_V3_CONFIGURATION');});
it('rejects inherited endpoints and invalid disposable profiles',()=>{for(const change of [{FIELD_JOURNEY_V3_APPROVED:'0'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_TEST_LAYOUT:'other'}])expect(()=>fieldJourneyV3Configuration({...env,...change},'win32')).toThrow('FIELD_JOURNEY_V3_CONFIGURATION');});
it('pins local profile and suppresses inherited credentials',async()=>{const p=fieldJourneyV3Configuration({...env,PGHOST:'external',PGPORT:'5432',PGPASSWORD:'secret'},'win32');expect(p.connection.host).toBe('127.0.0.1');expect(p.connection.port).toBe(55439);expect(p.connection.ssl).toBe(false);expect(typeof p.connection.password).toBe('function');if(typeof p.connection.password==='function')expect(await p.connection.password()).toBe('');});

it('V2 approval alone never authorizes V3 environment construction',async()=>{await expect(createFieldJourneyV3Environment({FIELD_JOURNEY_V2_APPROVED:'1'})).rejects.toThrow('FIELD_JOURNEY_V3_CONFIGURATION');});
it('rejects approved malformed profiles before constructing PostgreSQL clients',async()=>{for(const change of [{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_TEST_LAYOUT:'foreign'}])await expect(createFieldJourneyV3Environment({...env,...change})).rejects.toThrow('FIELD_JOURNEY_V3_CONFIGURATION');});
it('pins CI loopback, synthetic credential and extensions layout without creating clients',async()=>{
 const p=fieldJourneyV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci',TEXT_DRAFT_TEST_LAYOUT:'extensions',GITHUB_ACTIONS:'true',PGHOST:'external',PGPORT:'9999',PGPASSWORD:'private',DATABASE_URL:'postgres://private'},'linux');
 expect(p.layout).toBe('extensions');expect(p.connection.host).toBe('127.0.0.1');expect(p.connection.port).toBe(5432);expect(p.connection.user).toBe('postgres');expect(p.connection.ssl).toBe(false);expect(p.connection.options).toBe('');expect(typeof p.connection.password).toBe('function');if(typeof p.connection.password==='function')expect(await p.connection.password()).toBe('postgres');
});
it('rejects mismatched CI/platform profiles with finite configuration errors',()=>{
 expect(()=>fieldJourneyV3Configuration(env,'linux')).toThrow('FIELD_JOURNEY_V3_CONFIGURATION');
 for(const GITHUB_ACTIONS of ['false',undefined])expect(()=>fieldJourneyV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS},'linux')).toThrow('FIELD_JOURNEY_V3_CONFIGURATION');
 expect(()=>fieldJourneyV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'},'win32')).toThrow('FIELD_JOURNEY_V3_CONFIGURATION');
});
