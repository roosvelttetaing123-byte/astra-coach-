'use strict';
/* Astra Coach v5: exercise coaching metadata + gap foods. Loads after coach-overrides.js.
   mg   muscle credit per set (1 = primary, 0.5 = secondary); {} for mobility drills
   inc  smallest sensible load step in kg (0 = bodyweight / fixed)
   swaps  same-pattern substitutes, most joint-friendly first (existing ids only)
   uni  true when each side is trained (and logged) separately
   zone 'back' | 'shoulder' | null: which of RV's sensitive regions the lift loads */
(function(){const D=window.ASTRA_DATA;if(!D)return;
D.muscleGroups={chest:'Chest',back:'Back',shoulders:'Shoulders',biceps:'Biceps',triceps:'Triceps',quads:'Quads',hamstrings:'Hamstrings',glutes:'Glutes',calves:'Calves',core:'Core'};
D.volumeTargets={chest:[8,20],back:[10,22],shoulders:[8,22],biceps:[4,14],triceps:[4,14],quads:[8,20],hamstrings:[6,16],glutes:[4,18],calves:[4,12],core:[4,14]}; // weekly sets incl. 0.5 per secondary muscle; wide enough that the full programme itself lands inside
const meta={
/* mobility / flexibility: no muscle credit, no load */
breath:{mg:{},inc:0,swaps:[],uni:false,zone:null},
adductor:{mg:{},inc:0,swaps:[],uni:false,zone:null},
hipswitch:{mg:{},inc:0,swaps:[],uni:false,zone:null},
cat:{mg:{},inc:0,swaps:[],uni:false,zone:null},
flexhip:{mg:{},inc:0,swaps:[],uni:false,zone:null},
flexadd:{mg:{},inc:0,swaps:[],uni:false,zone:null},
flexpec:{mg:{},inc:0,swaps:[],uni:false,zone:null},
flextspine:{mg:{},inc:0,swaps:[],uni:false,zone:null},
flexham:{mg:{},inc:0,swaps:[],uni:false,zone:null},
/* core */
bird:{mg:{core:1,glutes:0.5},inc:0,swaps:['dead'],uni:false,zone:null},
dead:{mg:{core:1},inc:0,swaps:['bird','pallof'],uni:false,zone:null},
pallof:{mg:{core:1},inc:2.5,swaps:['sideplank','dead'],uni:true,zone:null},
sideplank:{mg:{core:1},inc:0,swaps:['pallof','dead'],uni:true,zone:null},
kneeraise:{mg:{core:1},inc:0,swaps:['dead','pallof'],uni:false,zone:null},
/* carries */
carry:{mg:{core:1,back:0.5},inc:2,swaps:['suitcase'],uni:false,zone:'back'},
suitcase:{mg:{core:1},inc:2,swaps:['carry'],uni:true,zone:'back'},
/* horizontal press */
bench:{mg:{chest:1,triceps:0.5,shoulders:0.5},inc:2.5,swaps:['dbpress','machinepress'],uni:false,zone:'shoulder',bar:20},
dbpress:{mg:{chest:1,triceps:0.5,shoulders:0.5},inc:2,swaps:['machinepress'],uni:false,zone:'shoulder'},
machinepress:{mg:{chest:1,triceps:0.5,shoulders:0.5},inc:5,swaps:['dbpress'],uni:false,zone:'shoulder'},
/* vertical press: no other vertical press in the library, so no same-pattern swap */
ohp:{mg:{shoulders:1,triceps:0.5},inc:2,swaps:[],uni:false,zone:'shoulder'},
/* shoulder isolation / rear delts */
latraise:{mg:{shoulders:1},inc:2,swaps:[],uni:false,zone:'shoulder'},
facepull:{mg:{shoulders:1,back:0.5},inc:2.5,swaps:[],uni:false,zone:'shoulder'},
/* arms */
curl:{mg:{biceps:1},inc:2,swaps:['hammer'],uni:false,zone:null},
hammer:{mg:{biceps:1},inc:2,swaps:['curl'],uni:false,zone:null},
triceps:{mg:{triceps:1},inc:2.5,swaps:['ohtri'],uni:false,zone:null},
ohtri:{mg:{triceps:1},inc:2.5,swaps:['triceps'],uni:false,zone:'shoulder'},
/* vertical pull */
latpull:{mg:{back:1,biceps:0.5},inc:2.5,swaps:['salatpull'],uni:false,zone:null},
salatpull:{mg:{back:1,biceps:0.5},inc:2.5,swaps:['latpull'],uni:true,zone:null},
/* horizontal pull */
row:{mg:{back:1,biceps:0.5},inc:2,swaps:['cablerow','sarow'],uni:false,zone:null},
cablerow:{mg:{back:1,biceps:0.5},inc:2.5,swaps:['row','sarow'],uni:false,zone:null},
sarow:{mg:{back:1,biceps:0.5},inc:2,swaps:['row','cablerow'],uni:true,zone:null},
/* squat / knee-dominant */
squat:{mg:{quads:1,glutes:0.5},inc:2.5,swaps:['hacksquat','legpress'],uni:false,zone:'back',bar:20},
hacksquat:{mg:{quads:1,glutes:0.5},inc:5,swaps:['legpress','bss'],uni:false,zone:null},
legpress:{mg:{quads:1,glutes:0.5},inc:5,swaps:['hacksquat','bss'],uni:false,zone:null},
bss:{mg:{quads:1,glutes:0.5},inc:2,swaps:['legpress','lunge'],uni:true,zone:null},
lunge:{mg:{quads:1,glutes:0.5},inc:2,swaps:['legpress','bss'],uni:true,zone:null},
/* hinge / hip extension */
rdl:{mg:{hamstrings:1,glutes:0.5},inc:2,swaps:['hipthrust','backext'],uni:false,zone:'back'},
slrdl:{mg:{hamstrings:1,glutes:0.5},inc:2,swaps:['hipthrust','backext'],uni:true,zone:'back'},
backext:{mg:{glutes:1,hamstrings:0.5,back:0.5},inc:2.5,swaps:['hipthrust'],uni:false,zone:'back'},
hipthrust:{mg:{glutes:1,hamstrings:0.5},inc:5,swaps:['slrdl','backext'],uni:false,zone:null},
/* knee flexion (only one in the library), glute med, calves */
curlLeg:{mg:{hamstrings:1},inc:5,swaps:[],uni:false,zone:null},
abduction:{mg:{glutes:1},inc:5,swaps:[],uni:false,zone:null},
calf:{mg:{calves:1},inc:5,swaps:[],uni:false,zone:null}
};
// uni is `true` only for these eight: sarow, salatpull, bss, slrdl, lunge, sideplank, pallof, suitcase
for(const id of Object.keys(D.exercises)){const m=meta[id];if(!m)continue;const e=D.exercises[id];e.mg=m.mg;e.inc=m.inc;e.swaps=m.swaps.slice();e.uni=m.uni;e.zone=m.zone;if(m.bar)e.bar=m.bar;}
/* New foods. `gap:true` = suitable as a "close the gap" top-up. */
const add=[
{id:'oats',name:'Oats (dry)',emoji:'🥣',unit:'g',base:40,portion:'40 g · dry rolled oats',p:5,c:27,f:2.8,k:150,gap:true},
{id:'pb',name:'Peanut butter',emoji:'🥜',unit:'tbsp',base:2,portion:'2 tbsp · smooth',p:7,c:7,f:16,k:190,gap:true},
{id:'banana',name:'Banana',emoji:'🍌',unit:'banana',base:1,portion:'1 medium banana',p:1.3,c:27,f:.4,k:105,gap:true},
{id:'nuts',name:'Mixed nuts',emoji:'🥜',unit:'g',base:30,portion:'30 g · unsalted',p:5,c:6,f:16,k:180,gap:true},
{id:'bread',name:'Wholemeal bread',emoji:'🍞',unit:'slices',base:2,portion:'2 slices',p:8,c:26,f:2,k:160},
{id:'cheese',name:'Cheddar',emoji:'🧀',unit:'g',base:30,portion:'30 g',p:7,c:.4,f:10,k:120,gap:true},
{id:'beef',name:'Beef mince 85% (cooked)',emoji:'🥩',unit:'g',base:100,portion:'100 g · cooked',p:26,c:0,f:15,k:250},
{id:'oil',name:'Olive oil',emoji:'🫒',unit:'tbsp',base:1,portion:'1 tbsp',p:0,c:0,f:14,k:120},
{id:'shake',name:'Homemade gainer shake',emoji:'🥤',unit:'shake',base:1,portion:'500 ml whole milk + whey + banana + 40 g oats + 1 tbsp peanut butter',p:50,c:85,f:29,k:770,gap:true}
];
if(Array.isArray(D.foods)){for(const f of D.foods)if(['whey','milk','yogurt'].includes(f.id))f.gap=true;for(const f of add)if(!D.foods.some(x=>x.id===f.id))D.foods.push(f);}
})();
