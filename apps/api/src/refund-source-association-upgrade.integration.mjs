// Actual pre-0136 row upgrade in an owned disposable database, not backfill.
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
 const dir=new URL('../../../supabase/migrations/',import.meta.url);const files=fs.readdirSync(dir).filter(x=>/^0[0-9]{3}.*\.sql$/.test(x)).sort();for(const f of files.filter(x=>x.slice(0,4)<='0135'))await c.query(fs.readFileSync(new URL(f,dir),'utf8'));
 const common={provider:'stripe_connect',platformAccountId:'acct_platformAAA',accountId:'acct_unknownAAA',livemode:false,eventCreated:1760000000,eventApiVersion:null,parserVersion:3,schemaVersion:3,intentId:'pi_upgradeAssociation',currency:'USD'};
 const observations=[{...common,eventId:'evt_upgradeCharge',objectType:'charge',eventType:'charge.refunded',chargeId:'ch_upgradeAssociation',chargeAmount:100,chargeCaptured:true,chargeAmountCaptured:100,chargeAmountRefunded:25,chargeRefunded:false},{...common,eventId:'evt_upgradeRefund',objectType:'refund',eventType:'refund.updated',refundId:'re_upgradeAssociation',chargeId:'ch_upgradeAssociation',refundAmount:25,refundStatus:'pending'}];
 const originals=[];for(const facts of observations){const r=(await c.query('select payment_internal.record_quarantined_event($1) r',[facts])).rows[0].r;originals.push({id:r.receiptId,row:(await c.query('select to_jsonb(r) r from payment_internal.event_receipts r where id=$1',[r.receiptId])).rows[0].r});}
 for(const file of files.filter(x=>x.slice(0,4)>='0136'&&x.slice(0,4)<='0137'))await c.query(fs.readFileSync(new URL(file,dir),'utf8'));
 for(const {id,row} of originals)assert.deepEqual((await c.query('select to_jsonb(r) r from payment_internal.event_receipts r where id=$1',[id])).rows[0].r,row);
 for(const table of ['charge_anchors','refund_anchors','charge_anchor_conflicts','refund_anchor_conflicts'])assert.equal((await c.query('select count(*) n from payment_internal.'+table)).rows[0].n,'0');
 assert.equal((await c.query('select lumin.payment_readiness_contract() ok')).rows[0].ok,true);console.log('PASS actual pre0136 v3 history unchanged and zero inferred association/conflict backfill');
}finally{if(c)await c.end();if(created)await control.query(`drop database ${name} with (force)`);await control.end();}
