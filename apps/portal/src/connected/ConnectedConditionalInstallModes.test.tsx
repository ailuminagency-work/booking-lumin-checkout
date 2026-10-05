import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import type {PaidConditionalPublicationReceipt} from '@lumin/runtime-client';
import {ConnectedConditionalInstallModes} from './ConnectedConditionalInstallModes';

const id='c52f77b7-dcfd-4280-b52d-1714514873c8';
const receipt:PaidConditionalPublicationReceipt={flowId:'be996fd0-e267-4f67-b89b-570308c45541',draftRevision:3,publication:{versionId:'065645f2-4a88-43ce-ae5c-821c44cb89bb',installationId:id,renderSchemaVersion:6,hostedPath:'/checkout/flow/'+id}};
afterEach(cleanup);
it('renders only immutable V6 staging inline and launcher snippets without requests or executable scripts',()=>{
 render(<ConnectedConditionalInstallModes expected={receipt}/>);
 for(const [label,mode] of [['Conditional staging JavaScript inline code','inline'],['Conditional staging launcher / modal code','launcher']]){
  const box=screen.getByLabelText(label!);
  expect(box).toHaveAttribute('readonly');
  expect(box).toHaveValue(`<script src="https://booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js" data-installation="${id}" data-mode="${mode}"></script>`);
 }
 expect(document.querySelector('script')).toBeNull();
 expect(screen.queryByRole('button')).toBeNull();
 expect(screen.queryByRole('link')).toBeNull();
 expect(screen.getByText(/Merchant website domains are not enabled/)).toBeTruthy();
 expect(screen.getByText(/Snippets alone do not certify browser loading/)).toBeTruthy();
 expect(screen.getByText(/retry an uncertain request/)).toBeTruthy();
});
it.each([
 null,[],{...receipt,secret:'do-not-render'},
 {...receipt,flowId:'not-a-form'}, {...receipt,flowId:receipt.flowId.toUpperCase()},
 ...[0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'3'].map(draftRevision=>({...receipt,draftRevision})),
 ...[3,4,5,7,'6'].map(renderSchemaVersion=>({...receipt,publication:{...receipt.publication,renderSchemaVersion}})),
 {...receipt,publication:{...receipt.publication,token:'do-not-render'}},
 {...receipt,publication:{...receipt.publication,installationId:'x" onload="do-not-render'}},
 {...receipt,publication:{...receipt.publication,versionId:'not-a-version'}},
 {...receipt,publication:{...receipt.publication,hostedPath:'https://foreign.example/do-not-render'}},
 {...receipt,publication:{...receipt.publication,hostedPath:'/checkout/flow/'+id+'?token=do-not-render'}},
 {...receipt,publication:{...receipt.publication,hostedPath:'/checkout/flow/be996fd0-e267-4f67-b89b-570308c45541'}},
])('fails closed for malformed, incompatible, injected or extra receipt values',invalid=>{
 render(<ConnectedConditionalInstallModes expected={invalid as PaidConditionalPublicationReceipt}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('verified immutable V6');
 expect(screen.queryByRole('textbox')).toBeNull();
 expect(document.body.textContent).not.toContain('do-not-render');
});
it('replaces both snippets on a newly verified selection and removes them on an invalid selection',()=>{
 const {rerender}=render(<ConnectedConditionalInstallModes expected={receipt}/>);
 const next='be996fd0-e267-4f67-b89b-570308c45541';
 rerender(<ConnectedConditionalInstallModes expected={{...receipt,publication:{...receipt.publication,installationId:next,hostedPath:'/checkout/flow/'+next}}}/>);
 for(const box of screen.getAllByRole('textbox')){expect((box as HTMLTextAreaElement).value).toContain(next);expect((box as HTMLTextAreaElement).value).not.toContain(id);}
 rerender(<ConnectedConditionalInstallModes expected={{...receipt,draftRevision:0}}/>);
 expect(screen.queryByRole('textbox')).toBeNull();
});
