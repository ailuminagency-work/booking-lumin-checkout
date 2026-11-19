import {describe,it,expect} from 'vitest';
import {housekeepingDatabaseTarget as target} from './housekeeping-test-target';
const local={PGHOST:'127.0.0.1',PGUSER:'postgres',PGPORT:'55449',PGDATABASE:'lumin_housekeeping_proof_unit'};
const ci={...local,PGPORT:'5432',CI:'true',GITHUB_ACTIONS:'true',POSTGRES_SERVICE_ID:'a'.repeat(64),HOUSEKEEPING_CI_DATABASE_HOST:'172.18.0.2'};
describe('Housekeeping disposable target',()=>{
 it('keeps native loopback exact',()=>expect(target(local)).toEqual({db:local.PGDATABASE,actor:'postgres',host:'127.0.0.1',port:55449}));
 it('uses separately inspected CI service address, not client loopback',()=>expect(target(ci).host).toBe('172.18.0.2'));
 for(const patch of [{PGHOST:'remote.test'},{PGUSER:'service_role'},{PGDATABASE:'postgres'},{PGPORT:'5432\n'},{HOUSEKEEPING_CI_DATABASE_HOST:'172.18.0.2'}])it('rejects local routing override '+JSON.stringify(patch),()=>expect(()=>target({...local,...patch})).toThrow());
 for(const patch of [{CI:undefined},{GITHUB_ACTIONS:undefined},{POSTGRES_SERVICE_ID:undefined},{POSTGRES_SERVICE_ID:'wrong'},{HOUSEKEEPING_CI_DATABASE_HOST:undefined},{HOUSEKEEPING_CI_DATABASE_HOST:'127.0.0.1'},{HOUSEKEEPING_CI_DATABASE_HOST:'8.8.8.8'},{HOUSEKEEPING_CI_DATABASE_HOST:'172.32.0.2'},{HOUSEKEEPING_CI_DATABASE_HOST:'172.18.0.999'},{HOUSEKEEPING_CI_DATABASE_HOST:'172.18.0.2\n'},{PGPORT:'55449'}])it('rejects unverified CI target '+JSON.stringify(patch),()=>expect(()=>target({...ci,...patch})).toThrow());
 for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])it('rejects '+key,()=>expect(()=>target({...ci,[key]:'override'})).toThrow());
});
