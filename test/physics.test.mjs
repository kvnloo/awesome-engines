import test from 'node:test';import assert from 'node:assert/strict';
import {sliderCrank,cylinderVolume,phaseLabel,samplePhysics,stepEnergy,sweptVolume,tracePV,TAU} from '../physics.mjs';
import {ENGINES,findEngine,FAMILIES} from '../catalog.mjs';

test('history starts with first known steam-reaction device and remains chronological',()=>{
  assert.equal(ENGINES[0].id,'aeolipile');assert.equal(ENGINES.at(-1).id,'f1-2026');
  assert.ok(ENGINES.length>=20);for(let i=1;i<ENGINES.length;i++)assert.ok(ENGINES[i].year>=ENGINES[i-1].year);
  for(const e of ENGINES){assert.ok(e.name&&e.principle&&e.parts.length>0);assert.match(e.source,/^https:\/\//);assert.ok(FAMILIES.includes(e.family));}
});
test('slider crank hits top/bottom dead center and returns to start',()=>{
  const r=.04,L=.14;const top=sliderCrank(0,r,L),bottom=sliderCrank(Math.PI,r,L),repeat=sliderCrank(TAU,r,L);
  assert.ok(Math.abs(top.displacement)<1e-12);assert.ok(Math.abs(bottom.displacement-2*r)<1e-12);
  assert.ok(Math.abs(repeat.wristY-top.wristY)<1e-12);
  assert.throws(()=>sliderCrank(0,1,.9),/rod length/);
});
test('swept and clearance volumes preserve geometric compression ratio',()=>{
 const e=findEngine('otto');const top=cylinderVolume(e,0),bottom=cylinderVolume(e,180);
 assert.ok(top.min>0);assert.ok(Math.abs(bottom.volume/top.volume-e.compression)<1e-8);
 assert.ok(Math.abs((bottom.volume-top.volume)-sweptVolume(e))<1e-12);
});
test('four-stroke phases distinguish 720 degrees',()=>{
 assert.deepEqual([0,180,360,540,720].map(phaseLabel),['INTAKE','COMPRESSION','POWER','EXHAUST','INTAKE']);
});
test('FIA 2026 electric rule-level envelope stays within 350 kW',()=>{
 const e=findEngine('f1-2026');const p=samplePhysics(e,1,9000,1,'deploy',.8);assert.ok(p.motorKw<=350);assert.equal(p.motorKw,350);
 assert.ok(p.netKw>=p.motorKw);assert.ok(Number.isFinite(p.pressure));
 const regen=samplePhysics(e,1,9000,1,'regen',.8);assert.ok(regen.motorKw<0);
});
test('synthetic energy store is clamped and reacts to deploy and regen',()=>{
 const e=findEngine('f1-2026');const deploy=samplePhysics(e,1,9000,1,'deploy',.8);
 const regen=samplePhysics(e,1,9000,1,'regen',.8);
 assert.ok(stepEnergy(.8,deploy,1,e)<.8);assert.ok(stepEnergy(.8,regen,1,e)>.8);
 assert.equal(stepEnergy(.01,deploy,100,e),0);assert.equal(stepEnergy(.99,regen,100,e),1);
});
test('traced P-V cycle is sampled consistently',()=>{
 const data=tracePV(findEngine('otto'));assert.equal(data.length,145);assert.deepEqual(data.map(p=>p.deg).slice(0,3),[0,5,10]);for(const p of data)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
});