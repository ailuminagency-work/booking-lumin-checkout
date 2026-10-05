import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,useLocation,useNavigate,useNavigationType} from 'react-router-dom';
import {LegacyRedirects} from './LegacyRedirects';

afterEach(cleanup);
function Location(){const location=useLocation(),navigate=useNavigate(),type=useNavigationType();return <><output aria-label="Current route">{location.pathname+location.search+location.hash}</output><output aria-label="Navigation type">{type}</output><button onClick={()=>navigate(-1)}>Back</button></>;}
it.each([
 ['/availability','/calendar/availability'],['/availability/','/calendar/availability'],
 ['/resources','/services/resources'],['/resources/','/services/resources'],
 ['/checkout','/embed'],['/checkout/','/embed'],
])('replaces exact legacy %s while retaining query/hash and back history',async(source,target)=>{
 render(<MemoryRouter initialEntries={['/prior',source+'?view=week#details']}><LegacyRedirects/><Location/></MemoryRouter>);
 expect(await screen.findByLabelText('Current route')).toHaveTextContent(target+'?view=week#details');
 expect(screen.getByLabelText('Navigation type')).toHaveTextContent('REPLACE');
 fireEvent.click(screen.getByRole('button',{name:'Back'}));
 expect(screen.getByLabelText('Current route')).toHaveTextContent('/prior');
});
it.each(['/bookings','/services/resources','/checkout/other','/availability//'])('does not redirect unmatched %s',path=>{
 render(<MemoryRouter initialEntries={[path+'?keep=1#same']}><LegacyRedirects/><Location/></MemoryRouter>);
 expect(screen.getByLabelText('Current route')).toHaveTextContent(path+'?keep=1#same');
 expect(screen.getByLabelText('Navigation type')).toHaveTextContent('POP');
});
