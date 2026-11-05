export const contributionTiers=Object.freeze([
 {id:'bronze',name:'브론즈',title:'업무초보자',min:1,max:9},
 {id:'silver',name:'실버',title:'업무숙련자',min:10,max:19},
 {id:'gold',name:'골드',title:'업무베테랑',min:20,max:29},
 {id:'platinum',name:'플래티넘',title:'업무마스터',min:30,max:39},
 {id:'diamond',name:'다이아',title:'업무의 신',min:40,max:50}
].map(tier=>Object.freeze(tier)));
export const contributionTier=level=>contributionTiers.find(tier=>level>=tier.min&&level<=tier.max);
