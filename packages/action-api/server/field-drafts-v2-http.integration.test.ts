import {expect,it,vi} from 'vitest';
import {fieldHttpV2Configuration,createFieldClientFixtureFetch} from './field-drafts-v2-http.integration';
const env={FIELD_DRAFT_V2_HTTP_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32)};
it('requires explicit approval and disposable database identity before I/O',()=>{expect(()=>fieldHttpV2Configuration({})).toThrow();for(const extra of [{FIELD_DRAFT_V2_HTTP_APPROVED:'0'},{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'}])expect(()=>fieldHttpV2Configuration({...env,...extra},'win32')).toThrow();});
it('pins loopback and bounds pool while ignoring inherited credentials',async()=>{const c=fieldHttpV2Configuration({...env,PGHOST:'external',PGPASSWORD:'secret'},'win32');expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(55439);expect(c.max).toBe(2);expect(c.connectionTimeoutMillis).toBe(5000);if(typeof c.password==='function')expect(await c.password()).toBe('');else throw Error('NO_CALLBACK');});

it('fixture wrapper preserves native request controls and adds only fixed trusted origin',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),count=vi.fn(),controller=new AbortController();vi.stubGlobal('fetch',fetcher);
 try{const wrapper=createFieldClientFixtureFetch('http://127.0.0.1:4199',count);const options:RequestInit={signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',method:'POST',body:'{}',headers:{Authorization:'Bearer synthetic-test'}};
 await wrapper('http://127.0.0.1:4199/api/test',options);expect(count).toHaveBeenCalledOnce();const sent=fetcher.mock.calls[0]?.[1];expect(sent).toMatchObject({signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',method:'POST',body:'{}'});expect(new Headers(sent?.headers).get('Origin')).toBe('http://127.0.0.1:4193');expect(new Headers(sent?.headers).get('Authorization')).toBe('Bearer synthetic-test');
 expect(()=>wrapper('http://external.example/api/test',options)).toThrow();expect(count).toHaveBeenCalledOnce();
 }finally{vi.unstubAllGlobals();}
});
