-- Optional exact question labels for coordinated text-draft clients only. No publication change.
-- CREATE OR REPLACE preserves existing owner and revoked application EXECUTE privileges.
begin;
create or replace function lumin.text_field_definition_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; k text; seen text[]:=array[]::text[]; lo numeric; hi numeric; question text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768 then return false; end if;
 if (p-array['schemaVersion','fields'])<>'{}'::jsonb or p->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p->'fields') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'fields')>64 then return false; end if;
 for f in select value from jsonb_array_elements(p->'fields') loop
  if jsonb_typeof(f)<>'object' then return false; end if;
  if (f-array['key','kind','required','minLength','maxLength','prompt'])<>'{}'::jsonb
   or jsonb_typeof(f->'key') is distinct from 'string' or f->'kind' is distinct from '"text"'::jsonb
   or jsonb_typeof(f->'required') is distinct from 'boolean'
   or jsonb_typeof(f->'minLength') is distinct from 'number' or jsonb_typeof(f->'maxLength') is distinct from 'number' then return false; end if;
  if f ? 'prompt' then
   if jsonb_typeof(f->'prompt') is distinct from 'string' then return false; end if;
   question:=f->>'prompt';
   -- PostgreSQL UTF8 text counts Unicode scalars; JSONB rejects NUL/lone surrogates before this function.
   -- Exact ECMAScript trim set, deliberately excluding U0085 and U200B.
   if char_length(question) not between 1 and 200
    or position(chr(10) in question)>0 or position(chr(13) in question)>0
    or position(chr(8232) in question)>0 or position(chr(8233) in question)>0
    or btrim(question,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))='' then return false; end if;
  end if;
  k:=f->>'key';
  if length(k) not between 1 and 64 or k collate "C" !~ '^[a-zA-Z][a-zA-Z0-9_]*$' or k in ('__proto__','prototype','constructor') or k=any(seen) then return false; end if;
  seen:=array_append(seen,k); lo:=(f->>'minLength')::numeric; hi:=(f->>'maxLength')::numeric;
  if lo<>trunc(lo) or hi<>trunc(hi) or lo<0 or hi>4096 or lo>hi or (f->'required'='true'::jsonb and hi=0) then return false; end if;
 end loop;
 return true;
end $$;

commit;
