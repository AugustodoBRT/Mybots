import * as T from 'three';
import {specFromFace,buildParticles,EYE_STYLES} from '/lib/mimo.mjs';
export function createBot(name,scene,world,quality,index){
 const spec=specFromFace(null,name),N=quality==='low'?2600:6200,P=buildParticles(spec,N),g=new T.BufferGeometry();
 const pos=new Float32Array(N*3),a=new Float32Array(N*3);for(let i=0;i<N;i++){pos.set([P.x[i]*spec.sx,-P.y[i]*spec.sy,P.z[i]*spec.sz],i*3);a.set([P.ph[i],P.size[i],P.light[i]],i*3)}g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('grain',new T.BufferAttribute(a,3));
 const color=new T.Color(`hsl(${spec.hue},60%,68%)`),eye=EYE_STYLES[spec.eyeStyle];
 const u={uTime:{value:0},uColor:{value:color},uPixel:{value:1},uBlink:{value:1},uSleep:{value:0},uError:{value:0},uWarm:{value:0},uLook:{value:0},uScale:{value:.52},uEye:{value:new T.Vector2(eye[1]*spec.sx*1.07,eye[2]*spec.sy*1.08)},uGap:{value:.34*spec.eyeGap*spec.sx},uEyeY:{value:-spec.eyeY*spec.sy},uEyes:{value:spec.eyes},uMouth:{value:Object.keys({nenhuma:0,pequena:1,sorriso:2,larga:3,redonda:4,dentes:5,gato:6}).indexOf(spec.mouth)}};
 const material=new T.ShaderMaterial({uniforms:u,transparent:true,depthWrite:false,vertexShader:`
 attribute vec3 grain; uniform float uTime,uPixel,uScale,uError; varying vec2 vFace; varying float vLight; varying float vPhase;
 void main(){vec3 p=position;float t=uTime*(.65+grain.z*.6);p+=.013*vec3(sin(t+grain.x+p.y*3.),cos(t*1.1+grain.x+p.x*3.),sin(t*.8+grain.x));p.x+=sin(uTime*35.+grain.x)*uError*.045;
 vec4 mv=modelViewMatrix*vec4(p,1.);vec4 center=modelViewMatrix*vec4(0.,0.,0.,1.);vFace=(mv.xy-center.xy)/uScale;vLight=.7+grain.z*.35+.1*sin(uTime*2.+grain.x);vPhase=grain.x;gl_Position=projectionMatrix*mv;gl_PointSize=uPixel*(1.1+grain.y*.6);}`,
 fragmentShader:`
 uniform vec3 uColor;uniform vec2 uEye;uniform float uBlink,uSleep,uError,uWarm,uLook,uGap,uEyeY,uEyes,uMouth;varying vec2 vFace;varying float vLight;varying float vPhase;
 bool oval(vec2 p,vec2 c,vec2 r){return dot((p-c)/r,(p-c)/r)<1.;}
 void main(){vec2 dotp=gl_PointCoord-.5;float d=length(dotp);if(d>.5)discard;
 vec2 p=vFace-vec2(uLook,0.);float h=max(.022,uEye.y*uBlink*(1.-uSleep*.93));
 bool hole=false;for(int i=0;i<2;i++){float side=i==0?-1.:1.;vec2 c=vec2(side*uGap,uEyeY);if(uEyes==1.)c.x=0.;if(uError>.6){vec2 q=p-c;hole=hole||(abs(q.x-q.y)<.045&&abs(q.x)<.2)||(abs(q.x+q.y)<.045&&abs(q.x)<.2);}else hole=hole||oval(p,c,vec2(uEye.x,h));}
 if(uEyes==3.)hole=hole||oval(p,vec2(0.,uEyeY+.31),vec2(.07,.075*uBlink));
 if(uMouth>0.){float mw=uMouth==4.?.09:uMouth==3.?.25:uMouth==1.?.09:.17;float mh=uMouth==4.?.095:.032;float curve=(uMouth==2.||uMouth==3.)?.09*(1.-pow(clamp(p.x/mw,-1.,1.),2.)):0.;hole=hole||oval(p,vec2(0.,-.38-curve),vec2(mw,mh));}
 if(hole)discard;vec3 c=mix(uColor,vec3(1.,.19,.12),uError*.7);c=mix(c,vec3(1.,.66,.3),uWarm*.16);gl_FragColor=vec4(c*vLight,(1.-smoothstep(.24,.5,d))*.88);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});material.toneMapped=false;
 const pts=new T.Points(g,material),group=new T.Group();group.add(pts);scene.add(group);group.scale.setScalar(.52);pts.frustumCulled=false;
 const shadow=world.shadow(0,0,1.6,1.35),halo=world.glow(color,0,1,0,1.5,.08);
 // A single shared trail per bot includes hop dust, fading by particle age.
 const count=quality==='low'?75:170,trailPos=new Float32Array(count*3),trailAlpha=new Float32Array(count),trailGeo=new T.BufferGeometry();trailGeo.setAttribute('position',new T.BufferAttribute(trailPos,3));trailGeo.setAttribute('alpha',new T.BufferAttribute(trailAlpha,1));
 const trailMat=new T.ShaderMaterial({uniforms:{color:{value:color},pixel:{value:1}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexShader:`attribute float alpha;varying float vAlpha;uniform float pixel;void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pixel*(1.6+alpha*1.8);}`,fragmentShader:`varying float vAlpha;uniform vec3 color;void main(){float d=length(gl_PointCoord-.5);if(d>.5||vAlpha<.01)discard;gl_FragColor=vec4(color,(1.-smoothstep(.15,.5,d))*vAlpha*.7); #include <colorspace_fragment> }`.replace(' #include','\n #include').replace('> }','>\n}')});
 const trail=new T.Points(trailGeo,trailMat);trail.frustumCulled=false;scene.add(trail);
 let yaw=.7;
 function update(s,t,timeline,pixel){
  const moving=s.moving,breath=1+Math.sin(t*2+index*1.7)*.017;const sleepy=s.state==='dormindo'&&!moving,working=s.state==='trabalhando'&&!moving;
  yaw=moving?s.direction:.7+Math.sin(t*.55+index)*.12;
  group.rotation.set(0,yaw,s.state==='esperando'?Math.sin(t*5)*.035:sleepy?.13:working?Math.sin(t*12)*.012:0);
  const base=.52;group.scale.set(base*breath/Math.sqrt(s.squash),base*breath*s.squash,base);
  group.position.set(s.pos[0]+(s.state==='erro'?Math.sin(t*33)*.045:0),s.pos[1]+.52*spec.sy+s.jump+(working?Math.sin(t*13+index)*.012:0),s.pos[2]);
  const bc=(t+index*.73)%5.2,blink=bc>4.9?1-Math.sin((bc-4.9)/.3*Math.PI)*.96:1;
  u.uTime.value=t;u.uBlink.value=blink;u.uSleep.value=sleepy?1:0;u.uError.value=s.state==='erro'?.7+.3*Math.sin(t*22):0;u.uWarm.value=working?1:0;u.uLook.value=Math.sin(t*.8+index)*.045+(moving?Math.sin(yaw-.7)*.12:0);u.uPixel.value=pixel;u.uScale.value=base;
  shadow.position.set(s.pos[0],s.pos[1]+.018,s.pos[2]);shadow.scale.setScalar(1-s.jump*.35);shadow.material.opacity=s.state==='concluido'?Math.max(0,.7-s.age*.12):.55-s.jump*.3;
  halo.position.copy(group.position);halo.material.opacity=sleepy?.035:.065;halo.scale.setScalar(1.45);trailMat.uniforms.pixel.value=pixel;
  for(let i=0;i<count;i++){const age=(i/count)*1.05,old=timeline.sample(name,Math.max(0,t-age)),h=(i*17.318)%6.283,spread=.08+age*.32;let p=old.pos;
   trailPos[i*3]=p[0]+Math.sin(h*3.1)*spread;trailPos[i*3+1]=p[1]+.16+old.jump*.5+Math.sin(h*2.1)*spread*.6;trailPos[i*3+2]=p[2]+Math.cos(h*2.2)*spread;trailAlpha[i]=old.moving?(1-age/1.05)*.7:0;
   if(s.state==='concluido'){const phase=(t*.55+i/count)%1,a=i*2.399+t*.2;trailPos[i*3]=group.position.x+Math.cos(a)*(.55+phase*.8);trailPos[i*3+1]=group.position.y+Math.sin(a*1.7)*(.4+phase*.4);trailPos[i*3+2]=group.position.z+Math.sin(a)*(.55+phase*.8);trailAlpha[i]=(1-phase)*.8;}
  }trailGeo.attributes.position.needsUpdate=true;trailGeo.attributes.alpha.needsUpdate=true;
 }
 return {spec,group,update,name};
}
