import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const require=createRequire(import.meta.url); const __dirname=dirname(fileURLToPath(import.meta.url));
const P=(f)=>join(__dirname,'../../src/data/',f);
const bosses=require(P('bosses.json')), itemTemplates=require(P('itemTemplates.json')), skills=require(P('skills.json'));
const floor=Math.floor,max=Math.max,min=Math.min,round=Math.round,pow=Math.pow;
const APPLY=process.argv.includes('--apply');

const CBS={Knight:{hp:120,mp:30,attack:10,defense:5,as:1.5,crit:0.03},Mage:{hp:80,mp:200,attack:6,defense:2,as:2.0,crit:0.05},Cleric:{hp:100,mp:150,attack:7,defense:4,as:2.0,crit:0.03},Archer:{hp:100,mp:80,attack:10,defense:3,as:2.5,crit:0.10},Rogue:{hp:90,mp:60,attack:9,defense:3,as:2.5,crit:0.15},Necromancer:{hp:85,mp:180,attack:6,defense:2,as:1.8,crit:0.05},Bard:{hp:95,mp:120,attack:8,defense:3,as:2.0,crit:0.07}};
const HPL={Knight:8,Mage:3,Cleric:5,Archer:4,Rogue:4,Necromancer:3,Bard:4};
const MILEHP={Knight:30,Mage:10,Cleric:15,Archer:15,Rogue:15,Necromancer:12,Bard:15};
const MAXCRIT={Knight:0.30,Mage:0.30,Cleric:0.30,Archer:1.0,Rogue:1.0,Necromancer:0.30,Bard:0.30};
const SKILLCOEF={Knight:0.5,Mage:0.8,Cleric:0.6,Archer:0.4,Rogue:0.3,Necromancer:0.8,Bard:0.5};
const ARMOR={Knight:'heavy',Mage:'magic',Cleric:'magic',Necromancer:'magic',Archer:'light',Rogue:'light',Bard:'light'};
const WEAPON={Knight:'sword',Mage:'staff',Cleric:'holy_wand',Archer:'bow',Rogue:'dagger',Necromancer:'dead_staff',Bard:'harp'};
const OFFH={Knight:'shield',Mage:'spellbook',Cleric:'holy_cross',Archer:'quiver',Rogue:'dagger',Necromancer:'voodoo_doll',Bard:'talisman'};
const CLASSES=Object.keys(CBS);
const RMULT={common:1.0,rare:1.15,epic:1.30,legendary:1.45,mythic:1.60,heroic:2.05};
const enh=(U)=>U<=0?1:1+U*0.10;
const spUp=(U)=>U<=0?1:1+min(U,10)*0.02+max(0,U-10)*0.01;
const RSLOTS={common:0,rare:1,epic:1,legendary:2,mythic:3,heroic:5};
const BRANGE={common:[1,5],rare:[3,12],epic:[5,18],legendary:[10,35],mythic:[20,60],heroic:[40,100]};
const SRM={hp:1,mp:1,attack:1,defense:1,speed:1,critChance:0.3,critDmg:1.5};
const upStat=(b,U)=>(b<=0||U<=0)?b:max(round(b*enh(U)),b+U);
const baseStat=(sc,G,R)=>max(1,floor((((sc.baseMin+sc.baseMax)/2)+floor(G*sc.perLevel))*RMULT[R]));
const weaponAvg=(sc,G,R,U)=>{const m=RMULT[R];const lb=G*sc.perLevel;const lo=max(1,floor((sc.baseMin+lb)*m));const hi=max(lo+1,floor((sc.baseMax+lb*1.15)*m));return((lo+hi)/2)*enh(U);};
const randBonus=(R,stat,excl)=>{const n=RSLOTS[R];if(n<=0)return 0;const pool=['hp','mp','attack','defense','speed','critChance','critDmg'].filter(s=>!excl.includes(s));if(!pool.includes(stat))return 0;const[lo,hi]=BRANGE[R];return(min(1,n/pool.length))*max(1,round(((lo+hi)/2)*(SRM[stat]??1)));};
const armorPiece=(cls,slot)=>{const g=itemTemplates.armor[ARMOR[cls]];return g&&g.pieces?g.pieces.find(p=>p.slot===slot):null;};
function player(cls,L,G,R,U){
  const b=CBS[cls],mile=floor(L/10);
  let hp=b.hp+(L-1)*HPL[cls]+mile*MILEHP[cls],atk=b.attack+mile,def=b.defense+mile,gH=0,gA=0,gD=0;
  for(const s of['helmet','armor','pants','shoulders','boots']){const sc=armorPiece(cls,s);if(sc){gH+=upStat(baseStat(sc.scaling,G,R)*6,U);gA+=randBonus(R,'attack',['hp']);gD+=randBonus(R,'defense',['hp']);}}
  const gl=armorPiece(cls,'gloves');if(gl)gA+=upStat(baseStat(gl.scaling,G,R),U);
  const ring=itemTemplates.accessories.find(t=>t.type==='ring'),neck=itemTemplates.accessories.find(t=>t.type==='necklace'),ear=itemTemplates.accessories.find(t=>t.type==='earrings');
  if(ring)for(let i=0;i<2;i++)gA+=upStat(baseStat(ring.scaling,G,R),U);
  if(neck)gD+=upStat(baseStat(neck.scaling,G,R),U); if(ear)gD+=upStat(baseStat(ear.scaling,G,R),U);
  const oh=itemTemplates.offhands.find(t=>t.type===OFFH[cls]); if(cls!=='Rogue'&&oh){const v=upStat(baseStat(oh.scaling,G,R),U);if(oh.baseStatType==='attack')gA+=v;else gD+=v;}
  const wsc=itemTemplates.weapons.find(t=>t.type===WEAPON[cls]);
  return{cls,attack:atk+gA,defense:def+gD,maxHp:hp+gH,wRoll:weaponAvg(wsc.scaling,G,R,U),as:b.as,dual:cls==='Rogue',U};
}
const getAttackMs=(s)=>max(500,floor(3000/max(1,s||1)));
const defPenOf=(sk)=>{const m=((sk&&sk.effect)||'').match(/(?:^|;)def_pen:(\d+)/);return m?min(0.6,+m[1]/100):0;};
function bestSkill(cls,L){let best=null,bv=-1;for(const sk of(skills.activeSkills[cls.toLowerCase()]||[])){if((sk.damage||0)<=0||((sk.unlockLevel||0)>L))continue;const v=sk.damage*(1+defPenOf(sk));if(v>bv){bv=v;best=sk;}}return best;}
function bossDPS(p,L,bossDef){
  const sk=bestSkill(p.cls,L); const skMult=sk?sk.damage:0; const dp=sk?defPenOf(sk):0;
  const skillHit=floor(p.attack*0.15*skMult*(1+dp)*spUp(p.U));
  const basic=max(1,(p.dual?p.attack+0.6*p.wRoll:p.attack)-bossDef)*(p.dual?2:1);
  return basic/(getAttackMs(p.as)/1000) + (skillHit>0?skillHit/5:0);
}
const BOSS_TTK=180;
function calibBoss(L){
  const refDef=round(player('Mage',L,L,'legendary',3).attack*0.10);
  const ref=player('Mage',L,L,'legendary',3);
  const scaledHP=round(bossDPS(ref,L,refDef)*BOSS_TTK);
  const squishHp=player('Mage',L,L,'legendary',3).maxHp;
  const scaledHit=round(squishHp/7);
  return{hp:max(1,round(scaledHP/3.5)),attack:max(1,round((scaledHit+ref.defense)/1.75)),defense:max(1,round(refDef/1.3))};
}
function bossSolo(cls,L,R,U){
  const p=player(cls,L,L,R,U); const c=calibBoss(L);
  const e={hp:c.hp*3.5,defense:c.defense*1.3};
  const ttk=e.hp/bossDPS(p,L,e.defense); return ttk;
}

console.log('=== BOSS solo TTK (s, with potions) per class × gear @ representative levels ===');
console.log('Thresholds: DPS-classes ~legendary+3 OK (~180s); support ~mythic+3; rare+3 should be slow.');
for(const L of [15,100,500,1000]){
  console.log(`-- L${L} (boss ${[...bosses].sort((a,b)=>Math.abs(a.level-L)-Math.abs(b.level-L))[0].id}) --`);
  for(const cls of CLASSES){
    const f=(R,U)=>{const t=bossSolo(cls,L,R,U);return isFinite(t)?(t>9999?'>9999':t.toFixed(0)):'INF';};
    console.log(`  ${cls.padEnd(11)} rare+3:${f('rare',3).padStart(5)} legend+3:${f('legendary',3).padStart(5)} mythic+3:${f('mythic',3).padStart(5)} heroic+7:${f('heroic',7).padStart(5)}`);
  }
}

if(APPLY){
  for(const b of bosses){const c=calibBoss(b.level);b.hp=c.hp;b.attack=c.attack;b.defense=c.defense;}
  writeFileSync(P('bosses.json'),JSON.stringify(bosses,null,2)+'\n');
  console.log('\nAPPLIED bosses.json ('+bosses.length+' bosses recalibrated).');
} else console.log('\n(dry — --apply writes bosses.json)');

if(process.argv.includes('--table')){
  const monsters=require(P('monsters.json'));
  const monByLvl=[...monsters].sort((a,b)=>a.level-b.level);
  const nearestMon=(L)=>monByLvl.reduce((x,m)=>Math.abs(m.level-L)<Math.abs(x.level-L)?m:x,monByLvl[0]);
  const highestMonLE=(L)=>{let r=monByLvl[0];for(const m of monByLvl)if(m.level<=L)r=m;return r;};
  function dungeonBossWave(L){const m=nearestMon(L),wp=1;let hs,as_,ds;if(L<=8){hs=1;as_=.9;ds=.9;}else if(L<=18){hs=1.2;as_=1.1;ds=1.1;}else{const lb=min(1,(L-20)/200);const bs=1.2+lb*.5;hs=bs+wp*(.3+lb*.5);as_=(1.1+lb*.4)+wp*(.3+lb*.4);ds=bs+wp*(.2+lb*.3);}const TM={h:5,a:2.5,d:2};return{hp:max(1,floor(m.hp*hs*TM.h)),defense:max(0,floor(m.defense*ds*TM.d))};}
  function raidWave(L){const base=highestMonLE(L);const gap=max(1,L-base.level);const wIdx=(L<=10?1:L<=50?2:L<=200?3:L<=500?4:5)-1;const mult=(1+gap*.05)*(1+wIdx*.15);return{hp:floor(base.hp*10*mult)*4,defense:floor(base.defense*2*mult)};}
  function dungDPS(p,L,def){const sk=bestSkill(p.cls,L);const dp=sk?defPenOf(sk):0;const sh=sk?floor(p.attack*0.15*sk.damage*(1+dp)*spUp(p.U)):0;const basic=max(1,(p.dual?p.attack+0.6*p.wRoll:p.attack)-def)*(p.dual?2:1);return basic/(getAttackMs(p.as)/1000)+(sh>0?sh/5:0);}
  function raidDPS(p,L,def){const sk=bestSkill(p.cls,L);const sh=sk?max(1,floor(p.attack*sk.damage*spUp(p.U))-floor(def*0.3)):0;const basic=max(1,(p.dual?floor(p.attack*0.6)*2:p.attack)-floor(def*0.5));return basic/(getAttackMs(p.as)*2/1000)+(sh>0?sh/5:0);}
  const gears=[['common',0],['rare',3],['epic',5],['legendary',3],['legendary',7],['mythic',3],['heroic',7]];
  const fmt=(t)=>!isFinite(t)?'INF':t>9999?'>9999':t<1?'<1':t.toFixed(0);
  for(const [name,enemyFn,dpsFn,note] of [['DUNGEON (boss-fala, solo)',dungeonBossWave,dungDPS,''],['RAID (fala ×4 bossy, 2 realnych graczy)',raidWave,(p,L,d)=>2*raidDPS(p,L,d),'2-osobowe party = ~2× DPS']]){
    console.log(`\n############ ${name} — TTK (s, z potionami) ${note} ############`);
    for(const L of [100,500]){
      const e=enemyFn(L);
      console.log(`\n=== Poziom ${L} (HP ${e.hp>=1e6?(e.hp/1e6).toFixed(1)+'M':e.hp>=1e3?(e.hp/1e3).toFixed(1)+'k':e.hp}) ===`);
      console.log('Klasa'.padEnd(12)+gears.map(([r,u])=>`${r.slice(0,3)}+${u}`.padStart(9)).join(''));
      for(const cls of CLASSES) console.log(cls.padEnd(12)+gears.map(([r,u])=>fmt(e.hp/dpsFn(player(cls,L,L,r,u),L,e.defense)).padStart(9)).join(''));
    }
  }
}

if(process.argv.includes('--extra')){
  const CLASSMOD={Knight:1.0,Mage:1.3,Cleric:1.0,Archer:1.2,Rogue:1.0,Necromancer:1.2,Bard:1.0};
  const CRIT={Knight:0.03,Mage:0.05,Cleric:0.03,Archer:0.10,Rogue:0.15,Necromancer:0.05,Bard:0.07};
  const tfBossHP=(L)=>Math.floor(95*Math.pow(L,1.1)+30)*5;
  const tfBossDef=(L)=>Math.floor(L*0.4)*3;
  function tfDPS(p,L){const csb=floor(min(100,L)*SKILLCOEF[p.cls]);const cm=CLASSMOD[p.cls];const cr=min(MAXCRIT[p.cls],CRIT[p.cls]);
    const basic=(p.dual?2*max(1,(p.attack+0.6*p.wRoll+csb)*cm-tfBossDef(L)):max(1,(p.attack+p.wRoll+csb)*cm-tfBossDef(L)))*(1+cr);
    const sk=bestSkill(p.cls,L);const sh=sk?floor(p.attack*0.15*sk.damage*spUp(p.U)):0;
    return basic/(getAttackMs(p.as)/1000)+(sh>0?sh/5:0);}
  const fmt=(t)=>!isFinite(t)?'INF':t>9999?'>9999':t<1?'<1':t.toFixed(0);
  const TIERS=[[1,30],[2,50],[3,100],[4,150],[5,200],[6,300],[7,500],[8,700],[9,800],[10,900],[11,1000]];
  console.log('\n############ TRANSFORMY — TTK boss-slota (s, z potionami) per klasa × gear ############');
  console.log('Cel: L50 ≈ legendary+5/mythic+2; OSTATNI (T11) ≈ mythic+7 (bardzo trudny)');
  for(const [t,L] of TIERS){
    const e={hp:tfBossHP(L),def:tfBossDef(L)};
    console.log(`\n=== Transform T${t} (L${L}, HP ${e.hp>=1e6?(e.hp/1e6).toFixed(1)+'M':(e.hp/1e3).toFixed(0)+'k'}) ===`);
    console.log('Klasa'.padEnd(12)+['rare+5','legend+5','mythic+2','mythic+7','heroic+7'].map(s=>s.padStart(9)).join(''));
    for(const cls of CLASSES) console.log(cls.padEnd(12)+[['rare',5],['legendary',5],['mythic',2],['mythic',7],['heroic',7]].map(([r,u])=>fmt(e.hp/tfDPS(player(cls,L,L,r,u),L)).padStart(9)).join(''));
  }
  console.log('\n\n############ UNDER-LEVELED: BOSS L200, postać L200, EQ L100 epic+5 (vs EQ L200 epic+5) ############');
  const e200=calibBoss(200),boss={hp:e200.hp*3.5,defense:e200.defense*1.3};
  console.log('Klasa'.padEnd(12)+'EQ-L100-epic+5'.padStart(16)+'EQ-L200-epic+5'.padStart(16)+'  (TTK s, z potionami)');
  for(const cls of CLASSES){
    const under=boss.hp/bossDPS(player(cls,200,100,'epic',5),200,boss.defense);
    const on=boss.hp/bossDPS(player(cls,200,200,'epic',5),200,boss.defense);
    console.log(cls.padEnd(12)+fmt(under).padStart(16)+fmt(on).padStart(16));
  }
}

if(process.argv.includes('--qa')){
  const CLASSMOD={Knight:1.0,Mage:1.3,Cleric:1.0,Archer:1.2,Rogue:1.0,Necromancer:1.2,Bard:1.0};
  const CRIT={Knight:0.03,Mage:0.05,Cleric:0.03,Archer:0.10,Rogue:0.15,Necromancer:0.05,Bard:0.07};
  const tfBossHP=(L)=>Math.floor(95*Math.pow(L,1.1)+30)*5, tfBossDef=(L)=>Math.floor(L*0.4)*3;
  function tfDPS(p,L,G){const csb=floor(min(100,L)*SKILLCOEF[p.cls]);const cm=CLASSMOD[p.cls];const cr=min(MAXCRIT[p.cls],CRIT[p.cls]);
    const basic=(p.dual?2*max(1,(p.attack+0.6*p.wRoll+csb)*cm-tfBossDef(L)):max(1,(p.attack+p.wRoll+csb)*cm-tfBossDef(L)))*(1+cr);
    const sk=bestSkill(p.cls,L);const sh=sk?floor(p.attack*0.15*sk.damage*spUp(p.U)):0;return basic/(getAttackMs(p.as)/1000)+(sh>0?sh/5:0);}
  const fmt=(t)=>!isFinite(t)?'INF':t>9999?'>9999':t.toFixed(0);
  console.log('\n############ Q1: L50 char, EQ common+0 @ item-lvl 30 — transform T2 (L50, HP '+(tfBossHP(50)/1000).toFixed(0)+'k) ############');
  console.log('Klasa'.padEnd(12)+'TTK(s) z potionami'.padStart(20));
  for(const cls of CLASSES) console.log(cls.padEnd(12)+fmt(tfBossHP(50)/tfDPS(player(cls,50,30,'common',0),50,30)).padStart(20));

  const GAP_POW=2.0;
  const gapMult=(G,L)=>G>=L?1:Math.max(0.02,Math.pow(G/L,GAP_POW));
  const e200=calibBoss(200),boss={hp:e200.hp*3.5,defense:e200.defense*1.3};
  console.log('\n############ Q2: BOSS L200 — gear-gap penalty proposal (dmg × (gearLvl/200)^2) ############');
  console.log('Penalty: gear L100→×0.25 (4× wolniej), L150→×0.56, L50→×0.06, L180→×0.81');
  console.log('Klasa'.padEnd(12)+'EQ100 TERAZ'.padStart(13)+'EQ100 z KARĄ'.padStart(14)+'EQ150 z KARĄ'.padStart(14)+'EQ200 (norma)'.padStart(14));
  for(const cls of CLASSES){
    const now=boss.hp/bossDPS(player(cls,200,100,'epic',5),200,boss.defense);
    const pen100=boss.hp/(bossDPS(player(cls,200,100,'epic',5),200,boss.defense)*gapMult(100,200));
    const pen150=boss.hp/(bossDPS(player(cls,200,150,'epic',5),200,boss.defense)*gapMult(150,200));
    const on=boss.hp/bossDPS(player(cls,200,200,'epic',5),200,boss.defense);
    console.log(cls.padEnd(12)+fmt(now).padStart(13)+fmt(pen100).padStart(14)+fmt(pen150).padStart(14)+fmt(on).padStart(14));
  }
}
