import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sliderCrank, TAU, clamp } from './physics.mjs';

// Part-addressable, parameterized 3D reconstructions. Mesh geometry is authored here;
// historical CAD accuracy and thermal/flow field validation are NOT claimed.
const MAT = {
  steel: 0xa1b7c4, polished: 0xc5cfd1, graphite: 0x394b58,
  brass: 0xcba16a, copper: 0xb36f49, dark: 0x1b3240,
  teal: 0x57a7a5, flame: 0xe18c54, blue: 0x528fae,
};
const metal=(color,roughness=.33,metalness=.86)=>new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
const steel=()=>metal(MAT.steel), polish=()=>metal(MAT.polished,.2), dark=()=>metal(MAT.graphite,.44), brass=()=>metal(MAT.brass,.31), copper=()=>metal(MAT.copper,.4), blue=()=>metal(MAT.blue,.47), teal=()=>metal(MAT.teal,.38);
const glass=()=>new THREE.MeshPhysicalMaterial({color:0x779cab,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide,roughness:.15,metalness:.18,transmission:0});
const vector=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const mesh=(group,geometry,material,pos=[0,0,0],rot=[0,0,0])=>{const m=new THREE.Mesh(geometry,material);m.position.set(...pos);m.rotation.set(...rot);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
const cyl=(group,r1,r2,height,material,pos=[0,0,0],rot=[0,0,0],segments=64)=>mesh(group,new THREE.CylinderGeometry(r1,r2,height,segments),material,pos,rot);
const ball=(group,r,material,pos=[0,0,0],segments=48)=>mesh(group,new THREE.SphereGeometry(r,segments,Math.max(24,segments/2)),material,pos);
const box=(group,w,h,d,material,pos=[0,0,0])=>mesh(group,new THREE.BoxGeometry(w,h,d),material,pos);
const torus=(group,r,t,material,pos=[0,0,0],rot=[0,0,0])=>mesh(group,new THREE.TorusGeometry(r,t,12,96),material,pos,rot);
function tube(group,pts,r,material){return mesh(group,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>vector(...p))),Math.max(32,pts.length*12),r,12,false),material);}
function rodBetween(group,a,b,r,material){const v1=vector(...a),v2=vector(...b);const m=cyl(group,r,r,v1.distanceTo(v2),material);m.position.copy(v1.clone().add(v2).multiplyScalar(.5));m.quaternion.setFromUnitVectors(vector(0,1,0),v2.sub(v1).normalize());return m;}
const glossy=()=>new THREE.MeshStandardMaterial({color:0xefb57d,metalness:.35,roughness:.4,emissive:0x683115,emissiveIntensity:.17});

export function createEngineViewer(container,{onSelect=()=>{},onAngle=()=>{}}={}){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b1520);
  scene.fog=new THREE.FogExp2(0x0b1520,.014);
  const camera=new THREE.PerspectiveCamera(44,1,.004,320);camera.position.set(7,5.4,9);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
  const coarse=window.matchMedia?.('(pointer:coarse)').matches;let maxDpr=coarse?1.45:1.9;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,maxDpr));renderer.setSize(container.clientWidth||900,container.clientHeight||620);
  container.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxDistance=55;controls.minDistance=.08;controls.maxPolarAngle=Math.PI*.93;
  const hemi=new THREE.HemisphereLight(0xdceff5,0x21303b,2.4);scene.add(hemi);
  const key=new THREE.DirectionalLight(0xffe3c2,3.4);key.position.set(5,10,6);scene.add(key);
  const rim=new THREE.DirectionalLight(0x74b9d1,3);rim.position.set(-8,5,-7);scene.add(rim);
  const floor=mesh(scene,new THREE.CircleGeometry(45,80),new THREE.MeshBasicMaterial({color:0x10202d,transparent:true,opacity:.55}),[0,-2.35,0],[-Math.PI/2,0,0]);floor.castShadow=false;
  const grid=new THREE.GridHelper(60,80,0x263949,0x1b2e3e);grid.position.y=-2.34;grid.material.transparent=true;grid.material.opacity=.38;scene.add(grid);
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let root=null,engine=null,parts=new Map(),animated=[],casings=[],selected=null,isolated=false,exploded=false,cutaway=true,dirty=true,playing=true,angle=0,rpm=120,last=0,disposed=false,raf=0,qualitySamples=[];
  let camGoal=null,camTarget=null;
  const invalidate=()=>{dirty=true;if(!raf)raf=requestAnimationFrame(frame)};
  controls.addEventListener('change',invalidate);
  const resize=()=>{if(disposed)return;const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);invalidate()};
  const ro=new ResizeObserver(resize);ro.observe(container);
  function group(parent, id,label,description){let item=parts.get(id);if(!item){item={id,label,description,groups:[],meshes:[]};parts.set(id,item)}const g=new THREE.Group();g.userData.partId=id;parent.add(g);item.groups.push(g);return g}
  function attachIds(){for(const p of parts.values())for(const g of p.groups){g.traverse(obj=>{if(obj.isMesh){obj.userData.partId=p.id;p.meshes.push(obj);if(!obj.material.userData?.original){obj.material.userData={...obj.material.userData,original:obj.material};}}});g.userData.rest=g.position.clone();}}
  function modelReciprocating(e){
    const power=e.layout==='f1'||e.layout==='hybrid';const multi=e.layout==='f1'?6:e.layout==='v8'?8:e.layout==='boxer'?2:e.layout==='radial'?7:1;
    const bankR=e.layout==='f1'?.48:e.layout==='v8'?.65:0;
    const isMulti=multi>1;
    const B=isMulti?.7:1;
    const primary=group(root,'block','Engine block','The load-bearing structure, cylinder supports and crankcase. A partial shell permits viewing the moving mechanism.');
    box(primary,isMulti?3.8:2.6,1.25,isMulti?3.7:2.2,dark(),[0,-.95,0]);
    const shell=mesh(primary,new THREE.CylinderGeometry(isMulti?1.65:1.07,isMulti?1.65:1.07,isMulti?2.5:3.6,96,1,true),glass(),[0,.48,0],[0,0,Math.PI/2]);casings.push(shell);
    const crank=group(root,'crankshaft','Crankshaft','Converts reciprocating force into shaft torque; bearing journals and counterweights carry cyclic loads.');
    crank.position.y=-.86;cyl(crank,.20,.20,isMulti?4.4:2.6,polish(),[0,0,0],[Math.PI/2,0,0]);
    for(let j=0;j<(isMulti?6:2);j++){const z=isMulti?(-1.45+j*.58):(-.7+j*1.4);box(crank,.62,.52,.16,steel(),[.15,0,z]);cyl(crank,.13,.13,.23,brass(),[0,0,z],[Math.PI/2,0,0]);}
    const fw=group(root,'flywheel','Flywheel','Stores rotational kinetic energy and smooths angular-speed variation between power strokes.');
    fw.position.y=-.86;cyl(fw,1.04,1.04,.24,steel(),[0,0,isMulti?2.45:1.5],[Math.PI/2,0,0],96);torus(fw,.74,.055,polish(),[0,0,isMulti?2.585:1.635]);
    for(let i=0;i<10;i++){let a=i*TAU/10;ball(fw,.068,brass(),[.84*Math.sin(a),.84*Math.cos(a),isMulti?2.61:1.66],16)}
    const pistons=[];
    const coils=group(root,'valvetrain','Valvetrain / injection','Gas exchange and ignition are phase-specific. Actuation details are illustrative rather than vehicle-validated.');
    for(let i=0;i<multi;i++){
      const z=multi===1?0:(i%(multi/2||1)-(multi/2-1)/2)*.93;
      const bank=multi===1?0:(Math.floor(i/(multi/2))===0?-1:1);
      const rotation=e.layout==='f1'||e.layout==='v8'?bank*bankR:e.layout==='boxer'?bank*Math.PI/2:e.layout==='radial'?i*TAU/multi:0;
      const centerX=multi===1?0:bank*(e.layout==='radial'?0:.7);
      const module=new THREE.Group();root.add(module);module.position.set(centerX,-.86,z);module.rotation.z=rotation;
      const pGroup=group(module,'pistons','Piston crowns + rings','Gas pressure loads the crown; sealing rings control blow-by and transfer heat to the cylinder wall.');
      const piston=new THREE.Group();pGroup.add(piston);
      const pm=cyl(piston,.5*B,.49*B,.5*B,polish(),[0,.24*B,0]);
      for(let j=0;j<3;j++)torus(piston,.5*B,.018,dark(),[0,.07*B+j*.09*B,0],[Math.PI/2,0,0]);
      cyl(piston,.11*B,.11*B,.9*B,steel(),[0,.1*B,0],[Math.PI/2,0,0]);
      const rodGroup=group(module,'connecting-rods','Connecting rods','The rigid linkage transmits piston force to the eccentric crank pin while constraining slider-crank motion.');
      const rodObj=rodBetween(rodGroup,[0,0,0],[0,1.2*B,0],.105*B,steel());
      ball(rodGroup,.18*B,brass());
      const cylGroup=group(module,'cylinder-liners','Cylinder liners','A precision bore guides piston motion and transfers combustion heat into the surrounding block and coolant.');
      const tubeMesh=mesh(cylGroup,new THREE.CylinderGeometry(.54*B,.54*B,2.15*B,72,1,true),glass(),[0,1.65*B,0]);casings.push(tubeMesh);
      const cap=group(module,'cylinder-head','Cylinder head','Houses inlet/exhaust paths, valves, and the spark plug or injector.');
      box(cap,1.27*B,.29*B,1.26*B,steel(),[0,2.82*B,0]);
      for(let j=-1;j<=1;j+=2){cyl(coils,.1*B,.12*B,.68*B,j<0?teal():copper(),[centerX+j*.27*B,2.96*B,z],[0,0,j*.21]);}
      const ign=group(module,'ignition','Ignition / fuel injector',e.id==='diesel'?'A fuel injector meters high-pressure fuel into compressed hot air.':'Combustion is initiated by spark or controlled fuel injection, depending on the engine cycle.');
      cyl(ign,.08*B,.05*B,.49*B,brass(),[0,3.05*B,0]);ball(ign,.07*B,glossy(),[0,2.8*B,0]);
      const base=group(module,'bearings','Wrist pins + bearings','Rotating and sliding interfaces require lubrication and careful clearance control.');
      torus(base,.16*B,.055,brass(),[0,1.0*B,.44*B]);
      pistons.push({piston,rodObj,rodGroup,module,offset:(i/(multi||1))*TAU,scale:B});
    }
    animated.push(a=>{for(let p of pistons){const rr=.41*p.scale,ll=1.55*p.scale;const k=sliderCrank(a+p.offset,rr,ll);const y=k.wristY;p.piston.position.y=y;p.rodObj.position.set(k.x/2,k.pinY/2+(y+k.pinY)/2,0);const low=vector(k.x,k.pinY,0),high=vector(0,y,0);p.rodObj.position.copy(low.clone().add(high).multiplyScalar(.5));p.rodObj.scale.set(1,low.distanceTo(high)/(1.2*p.scale),1);p.rodObj.quaternion.setFromUnitVectors(vector(0,1,0),high.sub(low).normalize());}crank.rotation.z=a;fw.rotation.z=a;});
    if(power){
      const turbo=group(root,'turbocharger','Turbocharger','Exhaust-gas turbine mechanically drives the compressor, raising intake charge density.');
      cyl(turbo,.58,.58,1.12,steel(),[2.65,1.25,.9],[Math.PI/2,0,0]);const blades=new THREE.Group();blades.position.set(2.65,1.25,.9);turbo.add(blades);
      for(let j=0;j<12;j++){let t=j*TAU/12;const b=box(blades,.14,.56,.08,teal(),[.39*Math.cos(t),.39*Math.sin(t),0]);b.rotation.z=t+.45;}
      tube(turbo,[[2.65,1.55,.9],[2.1,2.16,.9],[1.3,2.4,.3],[.2,2.5,.3]],.1,copper());
      const mgu=group(root,'mgu-k','MGU-K motor–generator','Bidirectional kinetic motor-generator for braking-energy recovery and powered deployment. Rated limits depend on FIA operating conditions.');
      cyl(mgu,.67,.67,.95,dark(),[-2.6,-.4,.4],[Math.PI/2,0,0]);torus(mgu,.46,.11,teal(),[-2.6,-.4,.92]);
      for(let j=0;j<16;j++){let a=j*TAU/16;const obj=box(mgu,.14,.18,.08,copper(),[-2.6+.53*Math.cos(a),-.4+.53*Math.sin(a),.95]);obj.rotation.z=a;}
      const battery=group(root,'energy-store','Energy store','High-voltage battery stores recovered kinetic energy and provides controlled electrical deployment.');
      box(battery,1.05,1.25,1.4,dark(),[-3.15,-1.3,-1.3]);for(let k=0;k<7;k++)box(battery,.1,.93,1.25,teal(),[-3.5+k*.13,-1.3,-1.3]);
      const inv=group(root,'inverter','Power electronics','Converts DC battery energy to controlled multi-phase electrical currents and handles regeneration.');
      box(inv,1.05,.7,1.15,steel(),[-2.15,1.35,-1.6]);for(let k=0;k<8;k++)box(inv,.075,.19,1.08,dark(),[-2.56+k*.12,1.8,-1.6]);
      const cables=group(root,'hv-cables','High-voltage conductors','Electrical path between the battery, inverter, and motor-generator. Routes are conceptual.');
      tube(cables,[[-3.0,-.7,-1.3],[-3,.05,-1.8],[-2.7,1.2,-1.8]],.075,copper());tube(cables,[[-2.1,1.25,-1.5],[-1.8,.4,-1.4],[-2.5,-.4,.4]],.07,teal());
      if(e.id==='f1-2014'){const mh=group(root,'mgu-h','MGU-H (pre-2026)','A heat-linked turbo electrical machine existed in the 2014-era architecture and was removed in 2026.');cyl(mh,.26,.26,.41,brass(),[2.65,1.25,1.65],[Math.PI/2,0,0]);}
      animated.push(a=>{blades.rotation.z=2*a;});
    }
  }
  function modelReaction(){
    const boiler=group(root,'boiler','Steam boiler','Heating water raises vapor pressure, supplying saturated steam to the rotating reaction vessel.');cyl(boiler,1.42,1.28,.65,copper(),[0,-1.35,0]);torus(boiler,1.35,.075,brass(),[0,-.97,0],[Math.PI/2,0,0]);
    for(let i=0;i<16;i++){const a=i*TAU/16;const b=ball(boiler,.045,brass(),[1.31*Math.cos(a),-1.2,1.31*Math.sin(a)],12);}
    const hearth=group(root,'hearth','Heat source','Heat enters the boiler through the vessel wall. Temperature and steam flow are illustrative.');cyl(hearth,1.42,1.42,.24,dark(),[0,-1.86,0]);for(let j=0;j<9;j++)ball(hearth,.13,glossy(),[-.9+j*.22,-1.7,0],16);
    const stand=group(root,'bearings','Pivot bearings','The suspension admits steam while allowing the sphere to rotate around its axis.');cyl(stand,.19,.19,3.15,steel(),[0,.1,0]);cyl(stand,.33,.33,.18,brass(),[0,1.63,0]);
    const feed=group(root,'steam-feed','Steam feed tube','Vapor flows from the boiler into the hollow sphere through a hollow spindle.');tube(feed,[[0,-.88,0],[0,0,0],[0,.9,0]],.12,brass());
    const rotor=group(root,'reaction-sphere','Hollow reaction sphere','A pressure vessel continuously rotates as steam is expelled tangentially from bent nozzles.');const spinning=new THREE.Group();spinning.position.y=.58;rotor.add(spinning);
    ball(spinning,.92,metal(0x9bb5be,.22),[0,0,0],80);torus(spinning,.92,.028,brass(),[0,0,0],[Math.PI/2,0,0]);torus(spinning,.92,.025,brass(),[0,0,0],[0,Math.PI/2,0]);
    const jets=group(root,'reaction-jets','Tangential reaction jets','Steam escaping through opposed curved tubes produces opposing jets whose reaction torques add.');
    jets.position.y=.58;for(const sign of [-1,1]){tube(jets,[[sign*.86,0,0],[sign*1.18,0,0],[sign*1.29,0,sign*.29]],.07,brass());ball(jets,.075,copper(),[sign*1.29,0,sign*.29],12);}
    animated.push(a=>{spinning.rotation.y=a;jets.rotation.y=a;});
  }
  function modelBeam(e){
    const boiler=group(root,'boiler','Boiler','Steam displaces air from the cylinder before a cold-water injection condenses it.');cyl(boiler,1.14,1.25,1.23,copper(),[-2.05,-1.55,-.35]);torus(boiler,1.13,.07,brass(),[-2.05,-.9,-.35],[Math.PI/2,0,0]);
    const cylinder=group(root,'cylinder','Steam cylinder','The pressure drop below the piston allows atmospheric pressure to do work.');cyl(cylinder,.86,.86,2.0,glass(),[1.35,-.52,0]);casings.push(...cylinder.children.filter(m=>m.isMesh));
    const piston=group(root,'piston','Atmospheric piston','Steam condensation creates partial vacuum and the piston moves under atmospheric pressure.');const moving=new THREE.Group();piston.add(moving);cyl(moving,.81,.81,.22,polish(),[1.35,-.4,0]);
    const lever=group(root,'walking-beam','Walking beam','A pivoted beam couples the moving piston to a mine-pump rod.');const rocking=new THREE.Group();rocking.position.set(0,2.2,0);lever.add(rocking);box(rocking,5.9,.24,.43,metal(0x8b6b4d,.8,0));cyl(lever,.26,.26,.73,brass(),[0,2.2,0],[Math.PI/2,0,0]);
    const rod=group(root,'pump-rod','Pump and piston rods','Reciprocating linkage transmits motion to a pump deep below the engine.');const links=new THREE.Group();rod.add(links);rodBetween(links,[2.75,2.1,0],[2.75,-1.7,0],.08,steel());rodBetween(links,[-2.78,2.1,0],[-2.78,-1.7,0],.08,steel());
    const steam=group(root,'steam-pipe','Steam and condenser piping','The separate condenser on Watt designs reduces repeated cooling of the cylinder wall.');tube(steam,[[-1.8,-1.1,-.35],[-.3,-1.1,-.35],[.2,-.92,0],[1.35,-.92,0]],.11,brass());
    if(e.id==='watt'){const cond=group(root,'condenser','Separate condenser','Cooling steam in a separate vessel retains more heat in the working cylinder.');cyl(cond,.5,.5,.95,blue(),[2.6,-1.55,0]);tube(cond,[[1.35,-1.4,0],[2.25,-1.4,0]],.09,teal());}
    animated.push(a=>{rocking.rotation.z=.15*Math.sin(a);moving.position.y=.39*Math.cos(a);links.rotation.z=.02*Math.sin(a);});
  }
  function modelTurbine(e){
    const jet=e.layout==='jet',motor=e.family==='Electric';
    const shell=group(root,'outer-casing','Engine nacelle / casing','Structural housing supports rotating assemblies; translucent cutaway reveals internal stages.');const caseMesh=mesh(shell,new THREE.CylinderGeometry(1.54,1.20,6.6,90,1,true),glass(),[0,0,0],[Math.PI/2,0,0]);casings.push(caseMesh);
    const shaft=group(root,'shaft','Rotor shaft','Couples compressor and turbine rotors; bearings carry radial and axial loading.');cyl(shaft,.18,.18,7.2,polish(),[0,0,0],[Math.PI/2,0,0]);
    const fan=group(root,'fan','Inlet fan','Accelerates a large air mass. High-bypass engines produce much of their thrust through bypass flow.');const spinning=new THREE.Group();fan.add(spinning);spinning.position.z=2.75;
    cyl(spinning,.36,.36,.26,brass(),[0,0,0],[Math.PI/2,0,0]);
    for(let i=0;i<18;i++){const a=i*TAU/18;const blade=box(spinning,.14,1.22,.13,polish(),[.81*Math.sin(a),.81*Math.cos(a),0]);blade.rotation.z=-a+.28;}
    const comp=group(root,'compressor','Axial compressor','Sequential rotating and stationary blade rows increase air pressure before combustion.');const spinningRows=new THREE.Group();comp.add(spinningRows);
    for(let row=0;row<4;row++){let z=1.45-row*.55;const rowG=new THREE.Group();rowG.position.z=z;spinningRows.add(rowG);cyl(rowG,.48,.48,.18,dark(),[0,0,0],[Math.PI/2,0,0]);for(let i=0;i<12;i++){let a=i*TAU/12;const blade=box(rowG,.12,.6,.1,teal(),[.63*Math.sin(a),.63*Math.cos(a),0]);blade.rotation.z=-a+.3;}}
    const chamber=group(root,'combustor','Combustion chamber','Fuel chemical energy raises the working-gas temperature downstream of the compressor.');cyl(chamber,1.12,1.12,1.27,metal(0x8d6244,.55),[0,0,-1.05],[Math.PI/2,0,0]);for(let i=0;i<10;i++){let a=i*TAU/10;ball(chamber,.095,glossy(),[.86*Math.sin(a),.86*Math.cos(a),-1.05],16);}
    const turbine=group(root,'turbine','Turbine stages','High-energy gas expands through blades, providing shaft power to the compressor and fan.');const turning=new THREE.Group();turbine.add(turning);
    for(let row=0;row<3;row++){let z=-1.95-row*.47;const rowG=new THREE.Group();rowG.position.z=z;turning.add(rowG);cyl(rowG,.51,.51,.18,steel(),[0,0,0],[Math.PI/2,0,0]);for(let i=0;i<14;i++){let a=i*TAU/14;const blade=box(rowG,.12,.48,.10,brass(),[.72*Math.sin(a),.72*Math.cos(a),0]);blade.rotation.z=-a-.25;}}
    const nozzle=group(root,'exhaust-nozzle','Exhaust nozzle','Gas exits through a shaped nozzle; momentum flux contributes to thrust.');cyl(nozzle,.58,.94,.66,steel(),[0,0,-3.1],[Math.PI/2,0,0]);
    if(e.id==='turbofan'){const bypass=group(root,'bypass-duct','Bypass duct','Air passes around the hot core, delivering a major share of turbofan thrust.');const m=mesh(bypass,new THREE.CylinderGeometry(1.75,1.65,4.6,96,1,true),glass(),[0,0,.45],[Math.PI/2,0,0]);casings.push(m)}
    animated.push(a=>{spinning.rotation.z=a;turning.rotation.z=a*.9;spinningRows.rotation.z=a;});
  }
  function modelElectric(){
    const housing=group(root,'housing','Drive-unit housing','The motor housing supports bearings, stator and cooling interfaces.');const m=mesh(housing,new THREE.CylinderGeometry(2.12,2.12,1.3,104,1,true),glass(),[0,0,0],[Math.PI/2,0,0]);casings.push(m);
    const stator=group(root,'stator','Stator windings','Alternating multi-phase currents create a rotating magnetic field in stationary copper coils.');torus(stator,1.72,.27,dark(),[0,0,0]);for(let i=0;i<24;i++){const a=i*TAU/24;const coil=box(stator,.28,.52,.7,i%3===0?teal():copper(),[1.58*Math.cos(a),1.58*Math.sin(a),0]);coil.rotation.z=a;}
    const rotor=group(root,'rotor','Magnetic rotor','Magnetic forces exchange energy across the air gap, applying torque to the rotating shaft.');const turning=new THREE.Group();rotor.add(turning);cyl(turning,1.11,1.11,.86,steel(),[0,0,0],[Math.PI/2,0,0]);for(let i=0;i<12;i++){let a=i*TAU/12;const magnet=box(turning,.35,.18,.97,i%2?brass():teal(),[1.03*Math.cos(a),1.03*Math.sin(a),0]);magnet.rotation.z=a;}
    const axis=group(root,'shaft','Output shaft','Transmits continuous electromagnetic torque to the reducer and driveline.');cyl(axis,.21,.21,3.1,polish(),[0,0,0],[Math.PI/2,0,0]);
    const gear=group(root,'reduction-gears','Reduction gearing','Converts high motor rotational speed to higher wheel torque.');cyl(gear,.82,.82,.26,steel(),[0,-.68,-1.55],[Math.PI/2,0,0]);for(let i=0;i<18;i++){let a=i*TAU/18;box(gear,.15,.18,.27,brass(),[.82*Math.sin(a),-.68+.82*Math.cos(a),-1.55]);}
    const inverter=group(root,'inverter','Power inverter','Semiconductor switches synthesize controlled phase currents from a high-voltage DC source.');box(inverter,1.8,.6,1.15,steel(),[-2.9,-1.36,0]);for(let i=0;i<10;i++)box(inverter,.11,.23,1.1,dark(),[-3.65+i*.16,-.93,0]);
    const wire=group(root,'copper-bus','Electrical interconnect','DC input busbars and multi-phase leads carry electrical energy.');tube(wire,[[-2,-1.12,0],[-1.3,-.9,.5],[-1.15,0,.5]],.06,copper());
    animated.push(a=>{turning.rotation.z=a;});
  }
  function modelRotary(){
    const caseGroup=group(root,'rotor-housing','Trochoidal rotor housing','A two-lobed epitrochoid defines working chambers around the eccentric rotary piston. Exact clearance geometry is not modeled.');
    const shape=new THREE.Shape();const n=160;for(let i=0;i<=n;i++){let t=i*TAU/n,r=1.6+.27*Math.cos(2*t);if(i===0)shape.moveTo(r*Math.cos(t),.88*r*Math.sin(t));else shape.lineTo(r*Math.cos(t),.88*r*Math.sin(t));}
    const geo=new THREE.ExtrudeGeometry(shape,{depth:.62,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.09,bevelThickness:.09,curveSegments:12});const casing=mesh(caseGroup,geo,glass(),[0,0,-.32]);casings.push(casing);
    const rotor=group(root,'rotor','Three-apex rotor','Changing chamber volumes produce compression and expansion. Rotor speed is one-third eccentric-shaft speed in this conceptual animation.');const spin=new THREE.Group();rotor.add(spin);
    const tri=new THREE.Shape();for(let i=0;i<3;i++){let a=i*TAU/3+Math.PI/2;i?tri.lineTo(1.33*Math.cos(a),1.33*Math.sin(a)):tri.moveTo(1.33*Math.cos(a),1.33*Math.sin(a))}tri.closePath();const triangle=mesh(spin,new THREE.ExtrudeGeometry(tri,{depth:.46,bevelEnabled:true,bevelSize:.13,bevelThickness:.09,bevelSegments:6,curveSegments:16}),brass(),[0,0,-.23]);
    for(let j=0;j<3;j++){let a=j*TAU/3+Math.PI/2;ball(spin,.11,polish(),[1.31*Math.cos(a),1.31*Math.sin(a),0],24)}
    const shaft=group(root,'eccentric-shaft','Eccentric shaft','Supports an offset rotating bearing and delivers output torque.');cyl(shaft,.29,.29,2,steel(),[0,0,0],[Math.PI/2,0,0]);
    const port=group(root,'intake-exhaust','Intake / exhaust ports','Side openings admit working fluid and release exhaust. Actual gas-exchange shape and timing are simplified.');tube(port,[[-2.45,.95,0],[-1.7,.95,0],[-1.3,.7,0]],.14,teal());tube(port,[[1.3,-.7,0],[1.7,-.95,0],[2.45,-.95,0]],.14,copper());
    animated.push(a=>{spin.rotation.z=a/3;spin.position.set(.11*Math.cos(a),.11*Math.sin(a),0)});
  }
  function build(e){
    engine=e;parts=new Map();animated=[];casings=[];selected=null;isolated=false;exploded=false;angle=0;dirty=true;
    if(root){scene.remove(root);root.traverse(o=>{if(o.isMesh){o.geometry?.dispose();o.material?.dispose();}})}
    root=new THREE.Group();scene.add(root);
    if(e.layout==='reaction')modelReaction();
    else if(e.layout==='beam')modelBeam(e);
    else if(e.layout==='jet'||e.layout==='turbine')modelTurbine(e);
    else if(e.layout==='electric')modelElectric();
    else if(e.layout==='rotary')modelRotary();
    else if(e.layout==='pump')modelBeam(e);
    else if(e.layout==='stirling')modelReciprocating(e);
    else modelReciprocating(e);
    attachIds();setCutaway(cutaway);update(0);frameAssembly();invalidate();return listParts();
  }
  const listParts=()=>[...parts.values()].map(({id,label,description,meshes})=>({id,label,description,meshes:meshes.length}));
  function update(a){for(const fn of animated)fn(a);invalidate();}
  function boundsFor(p){const b=new THREE.Box3();for(const g of p.groups){g.updateWorldMatrix(true,true);b.expandByObject(g,true)}return b;}
  function frameAssembly(){const b=new THREE.Box3().setFromObject(root);const center=b.getCenter(vector());const radius=Math.max(2,b.getSize(vector()).length()*.72);controls.target.copy(center);camera.position.copy(center.clone().add(vector(radius*.83,radius*.52,radius)));camera.near=.004;camera.far=320;camera.updateProjectionMatrix();controls.update();camGoal=null;invalidate();}
  function focus(id){const p=parts.get(id);if(!p)return;const b=boundsFor(p),center=b.getCenter(vector()),radius=Math.max(.19,b.getSize(vector()).length()*.53);camTarget=center;const direction=camera.position.clone().sub(controls.target).normalize();camGoal=center.clone().addScaledVector(direction,Math.max(.45,radius*2.5));invalidate();}
  function select(id,doFocus=false){selected=parts.has(id)?id:null;for(const p of parts.values())for(const m of p.meshes){if(m.material?.emissive){m.material.emissiveIntensity=p.id===selected?.32:0.0}}if(isolated)isolate(true);onSelect(selected);if(doFocus&&selected)focus(selected);invalidate();}
  function isolate(value){isolated=Boolean(value)&&Boolean(selected);for(const p of parts.values())for(const g of p.groups){g.visible=!isolated||p.id===selected}invalidate();}
  function setExplode(value){exploded=Boolean(value);let i=0;for(const p of parts.values()){for(const g of p.groups){const start=g.userData.rest;if(!start)continue;const center=boundsFor(p).getCenter(vector());let dir=center.clone().sub(root.position);dir.y*=.45;if(dir.length()<.1)dir.set(Math.sin(i*2.4),.4,Math.cos(i*2.4));dir.normalize();g.position.copy(start).addScaledVector(dir,exploded?.27+(i%3)*.15:0);i++}}invalidate();}
  function setCutaway(value){cutaway=Boolean(value);for(const m of casings){m.material.opacity=cutaway?.15:.72;m.material.depthWrite=!cutaway}invalidate();}
  function frame(now){raf=0;if(disposed)return;const dt=last?Math.min(.05,(now-last)/1000):0;last=now;
    if(document.hidden){return}
    if(playing&&engine){angle=(angle+rpm*TAU/60*dt)%(2*TAU);for(const fn of animated)fn(angle);onAngle(angle);dirty=true;}
    if(camGoal){camera.position.lerp(camGoal,.13);controls.target.lerp(camTarget,.13);if(camera.position.distanceToSquared(camGoal)<.00005){camera.position.copy(camGoal);controls.target.copy(camTarget);camGoal=null}dirty=true;}
    if(controls.update())dirty=true;
    if(dirty){renderer.render(scene,camera);dirty=false;}
    if(playing||camGoal)raf=requestAnimationFrame(frame);
  }
  function pointerPick(evt){const rect=renderer.domElement.getBoundingClientRect();pointer.set(2*(evt.clientX-rect.left)/rect.width-1,1-2*(evt.clientY-rect.top)/rect.height);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(root?.children||[],true).find(h=>h.object.userData.partId);if(hit)select(hit.object.userData.partId,evt.detail>=2);}
  renderer.domElement.addEventListener('click',pointerPick);document.addEventListener('visibilitychange',()=>{last=0;if(!document.hidden)invalidate()});
  function setPlaying(value){playing=Boolean(value);last=0;invalidate()}
  function setAngle(degrees){angle=degrees*Math.PI/180;for(const fn of animated)fn(angle);onAngle(angle);invalidate()}
  function setRPM(value){rpm=clamp(Number(value)||0,0,15000);invalidate()}
  function dispose(){disposed=true;cancelAnimationFrame(raf);ro.disconnect();controls.dispose();if(root)root.traverse(o=>{if(o.isMesh){o.geometry?.dispose();o.material?.dispose()}});renderer.dispose();renderer.domElement.remove()}
  invalidate();return{build,listParts,select,focus,frameAssembly,isolate,setExplode,setCutaway,setPlaying,setAngle,setRPM,dispose,get angle(){return angle},get selection(){return selected},get isolated(){return isolated}};
}