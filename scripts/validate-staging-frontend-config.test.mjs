import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCheckoutStaging} from './validate-staging-frontend-config.mjs';

const flat=readFileSync('deploy/netlify/checkout.staging.toml','utf8').replace(/\r\n/g,'\n');
const nested=readFileSync('deploy/netlify/checkout/netlify.toml','utf8');
const fixture=`[build]
 command = "npm run build --workspace @lumin/checkout"
 publish = "apps/checkout/dist"
[build.environment]
 NODE_VERSION = "20"
 VITE_RUNTIME_ENV = "staging"
 VITE_RUNTIME_MODE = "supabase"
 VITE_API_ORIGIN = "https://booking-lumin-api-staging.onrender.com"
 VITE_FLOW_API_URL = "https://booking-lumin-api-staging.onrender.com"
[context.deploy-preview]
 command = "npm run build --workspace @lumin/checkout"
`;
for(const source of [flat,nested,fixture,fixture.replace(/\n/g,'\r\n'),fixture+'\n# Public auth is externally supplied; no tenant injection.\n'])assert.doesNotThrow(()=>validateCheckoutStaging(source));
const mutations=[
 fixture.replace('VITE_RUNTIME_ENV = "staging"','VITE_RUNTIME_ENV = "production"'),
 fixture.replace('VITE_RUNTIME_ENV = "staging"','VITE_RUNTIME_ENV = "demo"'),
 fixture.replace('VITE_RUNTIME_MODE = "supabase"','VITE_RUNTIME_MODE = "mock"'),
 fixture.replace('VITE_RUNTIME_MODE = "supabase"','VITE_RUNTIME_MODE = "__SET_RUNTIME__"'),
 fixture.replace('VITE_API_ORIGIN = "https://booking-lumin-api-staging.onrender.com"','VITE_API_ORIGIN = "https://production.example.test"'),
 fixture.replace('VITE_FLOW_API_URL = "https://booking-lumin-api-staging.onrender.com"','VITE_FLOW_API_URL = "https://leadgate.example.test"'),
 fixture.replace('VITE_FLOW_API_URL = "https://booking-lumin-api-staging.onrender.com"','VITE_FLOW_API_URL = "__SET_RENDER_STAGING_API_URL__"'),
 fixture.replace('NODE_VERSION = "20"','NODE_VERSION = "22"'),
 fixture.replace('publish = "apps/checkout/dist"','publish = "apps/portal/dist"'),
 fixture.replaceAll('npm run build --workspace @lumin/checkout','npm run build --workspace @lumin/portal'),
 fixture.replace(' VITE_RUNTIME_ENV = "staging"\n',''),
 fixture.replace(' VITE_RUNTIME_MODE = "supabase"\n',''),
 fixture.replace('[build.environment]','[context.production.environment]'),
 fixture+'\n[context.branch-deploy.environment]\n VITE_RUNTIME_ENV = "production"\n',
 fixture+'\n[build.environment]\n VITE_RUNTIME_ENV = "production"\n',
 fixture.replace(' VITE_RUNTIME_ENV = "staging"',' VITE_RUNTIME_ENV = "staging"\n VITE_RUNTIME_ENV = "production"'),
 fixture.replace(' VITE_RUNTIME_MODE = "supabase"',' # VITE_RUNTIME_MODE = "supabase"'),
 fixture.replace('VITE_RUNTIME_ENV = "staging"','VITE_RUNTIME_ENV = "staging" # override'),
 fixture.replace('VITE_RUNTIME_MODE = "supabase"',"VITE_RUNTIME_MODE = 'supabase'"),
 ...['VITE_TENANT_ID','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','VITE_SECRET','VITE_LEADGATE_API_URL'].map(key=>fixture.replace('[build.environment]',`[build.environment]\n ${key} = "redacted-test-value"`)),
 fixture+'\n[[redirects]]\n from = "/*"\n to = "https://foreign.example.test"\n',
 undefined,
];
for(const source of mutations)assert.throws(()=>validateCheckoutStaging(source),/^Error: Checkout staging blueprint: invalid public site environment contract$/);
console.log(`validated 5 positive and ${mutations.length} negative injected Checkout staging configuration fixtures`);
