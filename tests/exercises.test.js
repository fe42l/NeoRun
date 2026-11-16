const { EXERCISES, RepCounter, angle } = require("../js/exercises.js");
const assert = require("assert");
// angle sanity
assert.strictEqual(Math.round(angle({x:0,y:-1},{x:0,y:0},{x:1,y:0})), 90);
assert.strictEqual(Math.round(angle({x:0,y:-1},{x:0,y:0},{x:0,y:1})), 180);
const P=(x,y)=>({x,y,score:.9});
// squat side view: hip-knee-ankle with knee angle k (degrees), upright torso
function squat(k, lean=10){
  const ankle=P(200,400), knee=P(200,300);
  const r=(180-k)*Math.PI/180; // thigh direction rotates from straight up
  const hip=P(200 - 100*Math.sin(r), 300 - 100*Math.cos(r));
  const l=lean*Math.PI/180;
  const sh=P(hip.x + 120*Math.sin(l), hip.y - 120*Math.cos(l));
  const kp=[];
  for (const s of ["left","right"]) kp.push({name:s+"_shoulder",...sh},{name:s+"_hip",...hip},{name:s+"_knee",...knee},{name:s+"_ankle",...ankle});
  return Object.fromEntries(kp.map(k=>[k.name,k]));
}
const c=new RepCounter(EXERCISES.squat, 1);
const seq=[175,170,140,110,90,85,110,150,170, 175,130,100,95,140,170, 175,140,125,150,170, 175,90,170];
let events=[];
for(const k of seq){ const r=c.update(EXERCISES.squat.measure(squat(k))); if(r.event) events.push(r.event+":"+k); }
console.log(events.join(" "), "count", c.count, "good", c.good);
assert.strictEqual(c.count,3);
// bad form
const c2=new RepCounter(EXERCISES.squat,1);
for(const k of [175,90,170]) c2.update(EXERCISES.squat.measure(squat(k, k<120?70:10)));
assert.strictEqual(c2.count,1); assert.strictEqual(c2.good,0);
// lost
assert.strictEqual(c.update(null).event,"lost");
console.log("ok");
