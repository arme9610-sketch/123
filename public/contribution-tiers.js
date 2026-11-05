export const contributionTiers=Object.freeze([
 {id:'bronze',name:'업무초보자',title:'업무초보자',min:1,max:9,required:1},
 {id:'silver',name:'숙련자',title:'업무숙련자',min:10,max:19,required:2},
 {id:'gold',name:'베테랑',title:'업무베테랑',min:20,max:29,required:3},
 {id:'platinum',name:'마스터',title:'업무마스터',min:30,max:39,required:4},
 {id:'diamond',name:'신',title:'업무의 신',min:40,max:50,required:5}
].map(tier=>Object.freeze(tier)));
export const contributionTier=level=>contributionTiers.find(tier=>level>=tier.min&&level<=tier.max);

export function levelStartXP(level){let total=0;for(let current=1;current<level;current++)total+=contributionTier(current).required;return total;}
