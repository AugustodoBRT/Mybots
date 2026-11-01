export const NAMES=['Lucas','Maniaco','Clara','Nina','Produtor de Terror','Teo'];
export const STATES=['normal','trabalhando','esperando','dormindo','concluido','erro'];
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
export const mix=(a,b,k)=>a+(b-a)*k;
const floorY=0,STEP=.28;
// Obstacle bounds include a particle-body clearance. Sofa entry uses an explicit elevated link.
export const obstacles=[[-5.65,-4.75,-3.8,-.9],[-5.65,-4.35,.5,2.45],[-4.95,4.7,-3.8,-2.34],[-.8,.95,.5,2.05],[1.65,5.25,2.05,3.9],[-5.65,-4.35,2.65,3.95],[4.45,5.65,-3.9,-2.55]];
export const blocked=(x,z)=>x< -5.2||x>5.25||z< -3.9||z>3.9||obstacles.some(b=>x>b[0]&&x<b[1]&&z>b[2]&&z<b[3]);
const key=(x,z)=>x+','+z;
export function findPath(from,to){
 const cell=p=>[Math.round(p[0]/STEP),Math.round(p[1]/STEP)],start=cell(from),goal=cell(to),goalKey=key(...goal);
 const open=[{x:start[0],z:start[1],g:0,f:0}],best=new Map([[key(...start),0]]),parents=new Map();let found=false;
 while(open.length){open.sort((a,b)=>a.f-b.f||a.x-b.x||a.z-b.z);const n=open.shift(),nk=key(n.x,n.z);if(nk===goalKey){found=true;break}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const x=n.x+dx,z=n.z+dz,k=key(x,z);if(blocked(x*STEP,z*STEP)&&k!==goalKey)continue;if(dx&&dz&&(blocked((n.x+dx)*STEP,n.z*STEP)||blocked(n.x*STEP,(n.z+dz)*STEP)))continue;const g=n.g+Math.hypot(dx,dz);if(g>=(best.get(k)??Infinity))continue;best.set(k,g);parents.set(k,nk);open.push({x,z,g,f:g+Math.hypot(x-goal[0],z-goal[1])})}}
 if(!found)throw new Error('Não há caminho livre até a estação.');
 const points=[];let k=goalKey;while(k!==key(...start)){points.unshift(k.split(',').map(Number).map(v=>v*STEP));k=parents.get(k);if(!k)throw new Error('Trajeto incompleto')}points.unshift(from.slice());points[points.length-1]=to.slice();
 // String-pulling: only remove corners when the full body-clearance segment is free.
 const free=(a,b)=>{const d=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(d/.06);for(let i=1;i<n;i++)if(blocked(mix(a[0],b[0],i/n),mix(a[1],b[1],i/n)))return false;return true};
 const out=[points[0]];let i=0;while(i<points.length-1){let j=points.length-1;while(j>i+1&&!free(points[i],points[j]))j--;out.push(points[j]);i=j}return out;
}
function route(from,to){
 let target=[to[0],to[2]],start=[from[0],from[2]],points;
 const sofaStart=from[1]>.65&&from[2]>2;const sofaEnd=to[1]>.65&&to[2]>2;
 const s=sofaStart?[from[0],1.67]:start,g=sofaEnd?[to[0],1.67]:target;
 points=findPath(s,g).map(([x,z])=>[x,0,z]);points[0]=sofaStart?[from[0],0,1.67]:from.slice();if(sofaStart)points.unshift(from.slice());
 if(sofaEnd)points.push(to.slice());else points[points.length-1]=to.slice();
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(...points[i].map((v,k)=>v-points[i-1][k])));
 const distance=lengths.at(-1);return {points,lengths,distance,hops:Math.max(1,Math.ceil(distance/.7)),duration:Math.max(1,Math.ceil(distance/.7))*.58};
}
function atDistance(r,d){let i=1;while(i<r.lengths.length-1&&r.lengths[i]<d)i++;const a=r.points[i-1],b=r.points[i],k=clamp((d-r.lengths[i-1])/Math.max(.0001,r.lengths[i]-r.lengths[i-1]));return {pos:a.map((v,j)=>mix(v,b[j],k)),direction:Math.atan2(b[0]-a[0],b[2]-a[2])}}
const stations={Lucas:[-3.55,.67,-1.96],Maniaco:[-.15,.67,-1.96],Clara:[3.25,.67,-1.96],Nina:[-3.9,0,1.35],'Produtor de Terror':[2.3,0,.55],Teo:[4.25,0,-.75]};
const defaultText={normal:'Pausa: terminou a lista de exercícios',trabalhando:'Montando o relatório de álgebra',esperando:'Preciso da sua aprovação',dormindo:'Dormindo; a próxima rotina é às 08:00',concluido:'Entregou o roteiro v2',erro:'Revendo o último passo'};
// What each free bot is up to before the story starts.
const IDLE={Clara:'Lendo os e-mails da manhã',Nina:'Pausa: terminou a lista de exercícios','Produtor de Terror':'Revisando o roteiro v2',Teo:'Organizando as rotinas de amanhã'};
export const SCRIPT=[
 {at:5,name:'Clara',state:'erro',text:'Revendo o último passo'},
 {at:6.2,name:'Clara',state:'esperando',text:'Preciso da sua aprovação'},
 {at:12,name:'Produtor de Terror',state:'concluido',text:'Entregou o roteiro v2'},
 {at:18,name:'Teo',state:'dormindo',text:'Dormindo; a próxima rotina é às 08:00'},
];
function stationary(name,state,text,at,pos){return {name,state,text,at,pos,move:null}}
export function createTimeline(){
 const events=new Map();
 function reset(){events.clear();for(const name of NAMES){const s=['Lucas','Maniaco'].includes(name)?'trabalhando':'normal';events.set(name,[stationary(name,s,name==='Lucas'?'Montando o relatório de álgebra':name==='Maniaco'?'Navegando: SIGAA':IDLE[name],0,stations[name].slice())])}for(const e of SCRIPT)setState(e.name,e.state,e.text,e.at);}
 function sample(name,t){const list=events.get(name);if(!list)throw new Error('Bot desconhecido: '+name);let e=list[0];for(const item of list)if(item.at<=t)e=item;
 let pos=e.pos.slice(),direction=.7,jump=0,squash=1,moving=false;const age=Math.max(0,t-e.at);
 if(e.move&&age<e.move.duration){const cycle=age/.58,phase=cycle%1,travel=clamp((phase-.14)/.7),k=smooth(travel),distance=e.move.distance*clamp((Math.floor(cycle)+k)/e.move.hops);const loc=atDistance(e.move,distance);pos=loc.pos;direction=loc.direction;moving=true;
 jump=phase>.14&&phase<.84?Math.sin(travel*Math.PI)*.35:0;
 squash=phase<.14?1-.18*Math.sin(phase/.14*Math.PI):phase<.84?1+.15*Math.sin(travel*Math.PI):1-.17*Math.sin((phase-.84)/.16*Math.PI);
 }else if(e.move){pos=e.move.points.at(-1).slice()}
 if(name==='Nina'&&e.state==='normal'&&!e.external){const way=[[-3.9,0,1.35],[-2.5,0,2.8],[-1.6,0,-.2],[1.35,0,-.15],[-3.9,0,1.35]];let offset=1.5;for(let i=1;i<way.length;i++){const r=ninaRoutes[i-1];if(t>=offset&&t<offset+r.duration){const c=(t-offset)/.58,p=c%1,v=clamp((p-.14)/.7),loc=atDistance(r,r.distance*clamp((Math.floor(c)+smooth(v))/r.hops));pos=loc.pos;direction=loc.direction;jump=p>.14&&p<.84?Math.sin(v*Math.PI)*.36:0;squash=p<.14?1-.2*Math.sin(p/.14*Math.PI):p<.84?1+.16*Math.sin(v*Math.PI):1-.15*Math.sin((p-.84)/.16*Math.PI);moving=true;break}else if(t>=offset+r.duration)pos=way[i].slice();offset+=r.duration+1.1}}
 if(e.state==='concluido'){const wait=e.move?e.move.duration:0,k=smooth((age-wait-1)/4);pos=[mix(pos[0],8.4,k),mix(pos[1],3.3,k)+Math.sin(age*2)*.08,mix(pos[2],-2.4,k)];jump=(1-k)*Math.abs(Math.sin(age*5))*.25;direction=.7}
 return {name,state:e.state,text:e.text,at:e.at,pos,direction,jump,squash,moving,age};
 }
 const ninaWay=[[-3.9,0,1.35],[-2.5,0,2.8],[-1.6,0,-.2],[1.35,0,-.15],[-3.9,0,1.35]];
 const ninaRoutes=ninaWay.slice(1).map((p,i)=>route(ninaWay[i],p));
 function setState(name,state,text=defaultText[state],at=0,external=false){if(!STATES.includes(state))throw new Error('Estado desconhecido: '+state);if(!events.has(name))throw new Error('Bot desconhecido: '+name);if(!Number.isFinite(at)||at<0)throw new Error('Tempo inválido');const prior=sample(name,at),pos=prior.pos.slice(),list=events.get(name).filter(e=>e.at<at||e.at===0);let goal=pos;
 if(state==='esperando')goal=[-4.15,0,-.1];if(state==='trabalhando')goal=(stations[name]||stations.Lucas).slice();if(state==='dormindo')goal=[3.35,.81,2.76];if(state==='normal')goal=[-2.5,0,2.75];
 const e=stationary(name,state,text,at,pos);e.external=external;if(Math.hypot(...goal.map((v,i)=>v-pos[i]))>.12)e.move=route(pos,goal);list.push(e);list.sort((a,b)=>a.at-b.at);events.set(name,list);return {name,state,at,duration:e.move?.duration||0};}
 reset();return {sample,setState,reset,events};
}
