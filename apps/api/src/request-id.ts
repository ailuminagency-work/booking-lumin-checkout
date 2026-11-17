import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';

const identifiers=new WeakMap<IncomingMessage,string>();

/** Server-only identity, shared across listening-server and flow delegation.
 * Never trust request headers or a pre-existing response header as authority. */
export function attachRequestId(req:IncomingMessage,res:ServerResponse):string{
 let identifier=identifiers.get(req);
 if(!identifier){identifier=randomUUID();identifiers.set(req,identifier);}
 res.setHeader('X-Request-Id',identifier);
 return identifier;
}
