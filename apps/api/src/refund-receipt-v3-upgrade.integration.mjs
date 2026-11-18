// Actual pre-0134 row upgrade in an owned disposable database, not backfill.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error('Unexpected database override');
const config={host:'127.0.0.1',port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres'},control=new pg.Client({...config,database:process.env.PGDATABASE});await control.connect();
const name='lumin_receipt_upgrade_'+randomUUID().replaceAll('-','');let created=false,c;
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
try{
 const locale=(await control.query("select datlocprovider,datcollate,datctype,coalesce(to_jsonb(d)->>'daticulocale',to_jsonb(d)->>'datlocale') icu from pg_database d where datname=current_database()")).rows[0];
 const clause=locale.datlocprovider==='i'?'LOCALE_PROVIDER icu ICU_LOCALE '+literal(locale.icu):'LC_COLLATE '+literal(locale.datcollate)+' LC_CTYPE '+literal(locale.datctype);
 await control.query(`create database ${name} template template0 encoding 'UTF8' ${clause}`);created=true;c=new pg.Client({...config,database:name});await c.connect();
 await c.query(fs.readFileSync(new URL('../../../supabase/tests/local_harness.sql',import.meta.url),'utf8'));
 const dir=new URL('../../../supabase/migrations/',import.meta.url);const files=fs.readdirSync(dir).filter(x=>/^0[0-9]{3}.*\.sql$/.test(x)).sort();for(const f of files.filter(x=>x.slice(0,4)<='0133'))await c.query(fs.readFileSync(new URL(f,dir),'utf8'));
 const base={provider:'stripe_connect',platformAccountId:'acct_platformAAA',accountId:'acct_unknownAAA',livemode:false,eventId:'evt_upgradeOriginalV1',objectType:'payment_intent',eventType:'payment_intent.succeeded',eventCreated:1760000000,eventApiVersion:null,parserVersion:1,schemaVersion:1,intentId:'pi_upgradeOriginal',intentAmount:100,currency:'USD'};
 const originals=[];for(const facts of [base,{...base,eventId:'evt_upgradeOriginalV2',parserVersion:2,schemaVersion:2,intentStatus:'succeeded',amountReceived:100,amountCapturable:0}]){const r=(await c.query('select payment_internal.record_quarantined_event($1) r',[facts])).rows[0].r;const row=(await c.query('select to_jsonb(r) r from payment_internal.event_receipts r where id=$1',[r.receiptId])).rows[0].r;originals.push({facts,r,row});}
 for(const file of files.filter(x=>x.slice(0,4)>='0134'&&x.slice(0,4)<='0135'))await c.query(fs.readFileSync(new URL(file,dir),'utf8'));
 for(const {facts,r,row} of originals){const after=(await c.query('select to_jsonb(r) r from payment_internal.event_receipts r where id=$1',[r.receiptId])).rows[0].r;const extra=Object.fromEntries(['charge_id','refund_id','charge_amount','charge_captured','charge_amount_captured','charge_amount_refunded','charge_refunded','refund_amount','refund_status'].map(k=>[k,null]));assert.deepEqual(after,{...row,...extra});assert.equal((await c.query('select payment_internal.record_quarantined_event($1) r',[facts])).rows[0].r.outcome,'duplicate');}
 assert.equal((await c.query('select lumin.payment_readiness_contract() ok')).rows[0].ok,true);console.log('PASS actual pre0134 PIv1/v2 rows retain exact identity/history and NULL refund fields, no enrichment, exact replay');
}finally{if(c)await c.end();if(created)await control.query(`drop database ${name} with (force)`);await control.end();}
