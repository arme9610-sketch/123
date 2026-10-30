import {pathToFileURL} from 'node:url';
import {officeHours} from '../lib/office-hours.mjs';
const target='https://one23-h665.onrender.com';
export async function reconcile({key,serviceId='',now=new Date(),request=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if(!key)throw new Error('Configure the GitHub Actions secret RENDER_API_KEY before enabling the schedule.');
  const desired=officeHours(now);
  async function api(path,method='GET') {
    const response=await request('https://api.render.com/v1'+path,{method,headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Render management API returned HTTP ${response.status}. Check key permissions and service state.`);
    return response.status===204?null:response.json();
  }
  if(!serviceId){
    let cursor='',matches=[];
    for(let page=0;page<100;page++){
      const rows=await api('/services?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(!Array.isArray(rows))throw new Error('Unexpected Render service list response.');
      for(const row of rows){const service=row.service??row;if(service.serviceDetails?.url?.replace(/\/$/,'')===target)matches.push(service.id);}
      const next=rows.at(-1)?.cursor;
      if(!next || next===cursor || !rows.length)break;
      cursor=next;
      if(page===99)throw new Error('Service discovery exceeded its safe limit. Configure RENDER_SERVICE_ID.');
    }
    matches=[...new Set(matches)];
    if(matches.length!==1)throw new Error('Could not uniquely locate the configured Dayon site. Set the RENDER_SERVICE_ID Actions variable.');
    serviceId=matches[0];
  }
  if(!/^srv-[A-Za-z0-9]+$/.test(serviceId))throw new Error('Invalid Render service ID.');
  const service=await api('/services/'+serviceId);
  if(service.serviceDetails?.url?.replace(/\/$/,'')!==target || service.type!=='web_service')throw new Error('Refusing to manage a service other than the configured Dayon web service.');
  if(!['suspended','not_suspended'].includes(service.suspended))throw new Error('Unknown Render suspension state. No action was taken.');
  if(desired.open){
    if(service.suspended==='suspended')await api('/services/'+serviceId+'/resume','POST');
    // Validate the application without creating an account or touching employee data.
    for(let attempt=0;attempt<12;attempt++){
      try{const response=await request(target+'/api/status',{signal:AbortSignal.timeout(20000)});if(response.ok && (await response.json()).initialized===true)return {action:'running',date:desired.date};}catch{/* Allow cold-start time. */}
      if(attempt<11)await pause(10000);
    }
    throw new Error('Resume requested, but Dayon readiness could not be confirmed. Inspect Render deployment events.');
  }
  if(service.suspended==='not_suspended')await api('/services/'+serviceId+'/suspend','POST');
  return {action:'suspended',date:desired.date};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await reconcile({key:process.env.RENDER_API_KEY,serviceId:process.env.RENDER_SERVICE_ID})));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
