import { readFileSync } from "node:fs";

const configs = [
  "deploy/netlify/checkout.staging.toml",
  "deploy/netlify/portal.staging.toml",
  "deploy/netlify/command-center.staging.toml",
];

const placeholders = /__SET_|__PLATFORM_CONTEXT_ONLY__/;
for (const path of configs) {
  const source = readFileSync(path, "utf8");
  if (!source.includes('NODE_VERSION = "20"')) throw new Error(`${path}: missing Node version`);
  if (!source.includes("npm run build --workspace")) throw new Error(`${path}: build must run from the workspace root`);
  if (!source.includes("publish = \"apps/")) throw new Error(`${path}: missing workspace publish directory`);
  if (!source.includes('VITE_RUNTIME_ENV = "staging"')) throw new Error(`${path}: missing staging runtime environment`);
  if (path.includes("command-center")) {
    if (!source.includes('VITE_RUNTIME_MODE = "mock"')) throw new Error(`${path}: command center requires explicit mock mode until platform context exists`);
    if (source.includes("VITE_TENANT_ID")) throw new Error(`${path}: must not invent a tenant id`);
  } else {
    if (!source.includes('VITE_API_ORIGIN = "__SET_RENDER_STAGING_API_URL__"')) throw new Error(`${path}: missing API origin placeholder`);
    if (!placeholders.test(source)) throw new Error(`${path}: staging values must remain explicit placeholders until provisioned`);
  }
}
console.log(`validated ${configs.length} frontend staging contracts`);

// Intentionally checks the narrow checked-in blueprint shape, not arbitrary YAML.
// Unexpected structure fails closed rather than guessing the effective env value.
export function validateApiStaging(source) {
  const lines=source.replace(/\r\n/g,"\n").split("\n").filter(line=>line.trim()&&!line.trimStart().startsWith("#"));
  const fail=()=>{throw new Error("API staging blueprint: invalid staging gate or secret configuration");};
  if(lines.filter(line=>/^  - type:/.test(line)).length!==1||!lines.includes("    name: booking-lumin-api-staging")||!lines.includes("    autoDeploy: false"))fail();
  const starts=lines.flatMap((line,index)=>line==="    envVars:"?[index]:[]);
  if(starts.length!==1)fail();
  const entries=new Map();
  for(let i=starts[0]+1;i<lines.length;i+=2){
    const key=lines[i]?.match(/^      - key: ([A-Z_]+)$/)?.[1];
    const setting=lines[i+1]?.match(/^        (value|sync): (.+)$/);
    if(!key||!setting||entries.has(key))fail();
    entries.set(key,{kind:setting[1],value:setting[2]});
  }
  for(const [key,value] of [["BOOKING_LUMIN_ENV","staging"],["BOOKING_LUMIN_FAKE_PAYMENTS",'"1"']]){
    const entry=entries.get(key);if(entry?.kind!=="value"||entry.value!==value)fail();
  }
  for(const key of ["DATABASE_URL","SUPABASE_URL","SUPABASE_ANON_KEY","OWNER_ORIGINS","CUSTOMER_ORIGINS"]){
    const entry=entries.get(key);if(entry?.kind!=="sync"||entry.value!=="false")fail();
  }
  const allowed=new Set(["NODE_ENV","PORT","BOOKING_LUMIN_ENV","BOOKING_LUMIN_FAKE_PAYMENTS","DATABASE_URL","SUPABASE_URL","SUPABASE_ANON_KEY","OWNER_ORIGINS","CUSTOMER_ORIGINS"]);
  if([...entries.keys()].some(key=>!allowed.has(key)))fail();
}
const apiSource=readFileSync("apps/api/render.staging.yaml","utf8");
validateApiStaging(apiSource);
if(process.argv.includes("--self-test")){
  const {default:assert}=await import("node:assert/strict");
  const mutations=[
    apiSource.replace("value: staging","value: production"),
    apiSource.replace('value: "1"','value: "0"'),
    apiSource.replace("      - key: BOOKING_LUMIN_ENV", "      - key: WRONG_ENV"),
    apiSource+"\n      - key: BOOKING_LUMIN_FAKE_PAYMENTS\n        value: \"0\"\n",
    apiSource.replace("    autoDeploy: false","    autoDeploy: true"),
    apiSource.replace("    name: booking-lumin-api-staging","    name: booking-lumin-api-production"),
    apiSource.replace("      - key: DATABASE_URL\n        sync: false","      - key: DATABASE_URL\n        value: redacted-test-secret"),
  ];
  // Normalize fixture newlines so the secret-value attack also runs on Windows.
  mutations[6]=apiSource.replace(/\r\n/g,"\n").replace("      - key: DATABASE_URL\n        sync: false","      - key: DATABASE_URL\n        value: redacted-test-secret");
  for(const source of mutations)assert.throws(()=>validateApiStaging(source),/^Error: API staging blueprint: invalid staging gate or secret configuration$/);
  console.log("validated 7 negative API staging configuration fixtures");
}
console.log("validated API staging gates and unset external configuration");
