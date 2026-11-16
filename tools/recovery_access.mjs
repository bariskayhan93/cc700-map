// Named PC sensitivity profile; never a legal-access certification or production default.
import {conservativeWayPolicy} from './recovery_study.mjs';
const firm=new Set(['asphalt','paved','concrete','concrete:plates','paving_stones','compacted','fine_gravel','gravel']);
export const NRW_PROFILE={id:'nrw-firm-path-study-v1',status:'inference-unvalidated',
 sources:['https://wiki.openstreetmap.org/wiki/OSM_tags_for_routing/Access_restrictions#Germany',
 'https://recht.nrw.de/lrgv/gesetz/30102026-landesforstgesetz-lfog/'],
 gaps:['ownership/signs/closures and forest/protected-area context not established','surface is an imperfect fixed-way proxy','physical bicycle suitability unvalidated']};
export function nrwFirmPathPolicy(tags){
 if(tags.motorroad&&tags.motorroad!=='no')return {reason:'motorroad-not-admitted'};
 const ordinary=conservativeWayPolicy(tags);
 if(ordinary.reason!=='highway-needs-explicit-bicycle-access')return ordinary;
 if(!['path','track'].includes(tags.highway)||!firm.has(tags.surface)||['designated','official'].includes(tags.foot)||['designated','official'].includes(tags.horse))return ordinary;
 // Existing access denial and conditional/directional checks already ran first.
 return {...conservativeWayPolicy({...tags,bicycle:'yes'}),inferredAccess:true};
}
