// ============================================================================
// Grimshade — kill-RATE calibration (spec 2026-06-20, Option A).
// With potions you don't die, so "how many you kill" = KILL RATE (speed):
//   killsWithPotion = BUDGET / TTK ,  TTK = monsterHP / playerBasicDPS
// DPS classes kill more; gear (rarity/upgrade) raises DPS -> more kills.
// Also reports killsNoPotion = min(rate, survival) for the early-game floor.
// Run: node scripts/balance/calibrate.mjs            (dry)
//      node scripts/balance/calibrate.mjs --apply    (writes monsters.json + gear consts note)
// ============================================================================
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const require=createRequire(import.meta.url); const __dirname=dirname(fileURLToPath(import.meta.url));
const P=(f)=>join(__dirname,'../../src/data/',f);
const monsters=require(P('monsters.json')), itemTemplates=require(P('itemTemplates.json'));
const floor=Math.floor,max=Math.max,min=Math.min,round=Math.round;
const APPLY=process.argv.includes('--apply');

const CBS={Knight:{hp:120,mp:30,attack:10,defense:5,as:1.5,crit:0.03},Mage:{hp:80,mp:200,attack:6,defense:2,as:2.0,crit:0.05},Cleric:{hp:100,mp:150,attack:7,defense:4,as:2.0,crit:0.03},Archer:{hp:100,mp:80,attack:10,defense:3,as:2.5,crit:0.10},Rogue:{hp:90,mp:60,attack:9,defense:3,as:2.5,crit:0.15},Necromancer:{hp:85,mp:180,attack:6,defense:2,as:1.8,crit:0.05},Bard:{hp:95,mp:120,attack:8,defense:3,as:2.0,crit:0.07}};
const HPL={Knight:8,Mage:3,Cleric:5,Archer:4,Rogue:4,Necromancer:3,Bard:4};
const MILEHP={Knight:30,Mage:10,Cleric:15,Archer:15,Rogue:15,Necromancer:12,Bard:15};
const CLASSMOD={Knight:1.0,Mage:1.3,Cleric:1.0,Archer:1.2,Rogue:1.0,Necromancer:1.2,Bard:1.0};
const MAXCRIT={Knight:0.30,Mage:0.30,Cleric:0.30,Archer:1.0,Rogue:1.0,Necromancer:0.30,Bard:0.30};
const SKILLCOEF={Knight:0.5,Mage:0.8,Cleric:0.6,Archer:0.4,Rogue:0.3,Necromancer:0.8,Bard:0.5};
const ARMOR={Knight:'heavy',Mage:'magic',Cleric:'magic',Necromancer:'magic',Archer:'light',Rogue:'light',Bard:'light'};
const WEAPON={Knight:'sword',Mage:'staff',Cleric:'holy_wand',Archer:'bow',Rogue:'dagger',Necromancer:'dead_staff',Bard:'harp'};
const OFFH={Knight:'shield',Mage:'spellbook',Cleric:'holy_cross',Archer:'quiver',Rogue:'dagger',Necromancer:'voodoo_doll',Bard:'talisman'};
const CLASSES=Object.keys(CBS);

// GEAR scaling tuned to the spec: +15% kills/rarity, heroic +105%, +10% kills/upgrade
const RMULT={common:1.0,rare:1.15,epic:1.30,legendary:1.45,mythic:1.60,heroic:2.05};
const enh=(U)=>U<=0?1:1+U*0.10; // +10% DPS per upgrade -> +10% kills
const RSLOTS={common:0,rare:1,epic:1,legendary:2,mythic:3,heroic:5};
const BRANGE={common:[1,5],rare:[3,12],epic:[5,18],legendary:[10,35],mythic:[20,60],heroic:[40,100]};
const SRM={hp:1,mp:1,attack:1,defense:1,speed:1,critChance:0.3,critDmg:1.5};
const upStat=(b,U)=>(b<=0||U<=0)?b:max(round(b*enh(U)),b+U);
const baseStat=(sc,G,R)=>max(1,floor((((sc.baseMin+sc.baseMax)/2)+floor(G*sc.perLevel))*RMULT[R]));
const weaponAvg=(sc,G,R,U)=>{const m=RMULT[R];const lb=G*sc.perLevel;const lo=max(1,floor((sc.baseMin+lb)*m));const hi=max(lo+1,floor((sc.baseMax+lb*1.15)*m));return((lo+hi)/2)*enh(U);};
const randBonus=(R,stat,excl)=>{const n=RSLOTS[R];if(n<=0)return 0;const pool=['hp','mp','attack','defense','speed','critChance','critDmg'].filter(s=>!excl.includes(s));if(!pool.includes(stat))return 0;const[lo,hi]=BRANGE[R];return(min(1,n/pool.length))*max(1,round(((lo+hi)/2)*(SRM[stat]??1)));};
const armorPiece=(cls,slot)=>{const g=itemTemplates.armor[ARMOR[cls]];return g&&g.pieces?g.pieces.find(p=>p.slot===slot):null;};
function player(cls,L,G,R,U,noGear=false){
  const b=CBS[cls],mile=floor(L/10);
  let hp=b.hp+(L-1)*HPL[cls]+mile*MILEHP[cls], atk=b.attack+mile, def=b.defense+mile;
  let gH=0,gA=0,gD=0;
  if(!noGear){
    for(const s of['helmet','armor','pants','shoulders','boots']){const sc=armorPiece(cls,s);if(sc){gH+=upStat(baseStat(sc.scaling,G,R)*6,U);gA+=randBonus(R,'attack',['hp']);gD+=randBonus(R,'defense',['hp']);}}
    const gl=armorPiece(cls,'gloves');if(gl)gA+=upStat(baseStat(gl.scaling,G,R),U);
    const ring=itemTemplates.accessories.find(t=>t.type==='ring'),neck=itemTemplates.accessories.find(t=>t.type==='necklace'),ear=itemTemplates.accessories.find(t=>t.type==='earrings');
    if(ring)for(let i=0;i<2;i++)gA+=upStat(baseStat(ring.scaling,G,R),U);
    if(neck)gD+=upStat(baseStat(neck.scaling,G,R),U); if(ear)gD+=upStat(baseStat(ear.scaling,G,R),U);
    const oh=itemTemplates.offhands.find(t=>t.type===OFFH[cls]); if(cls!=='Rogue'&&oh){const v=upStat(baseStat(oh.scaling,G,R),U);if(oh.baseStatType==='attack')gA+=v;else gD+=v;}
  }
  const wsc=itemTemplates.weapons.find(t=>t.type===WEAPON[cls]);
  const wRoll=noGear?weaponAvg(wsc.scaling,1,'common',0):weaponAvg(wsc.scaling,G,R,U);
  const wskill=min(100,L), csb=floor(wskill*SKILLCOEF[cls]);
  return{cls,attack:atk+gA,defense:def+gD,maxHp:hp+gH,wRoll,csb,classMod:CLASSMOD[cls],crit:min(MAXCRIT[cls],b.crit),as:b.as,dual:cls==='Rogue'};
}
const getAttackMs=(s)=>max(500,floor(3000/max(1,s||1)));
function basicHit(p,enemyDef){
  if(p.dual)return 2*max(1,(p.attack+0.6*p.wRoll+p.csb)*p.classMod-enemyDef)*(1+p.crit);
  return max(1,(p.attack+p.wRoll+p.csb)*p.classMod-enemyDef)*(1+p.crit);
}
const playerDPS=(p,enemyDef)=>basicHit(p,enemyDef)/(getAttackMs(p.as)/1000);

// ---- MONSTER calibration (kill-RATE model) ----
const MON_SPEED=2.0, MON_INT=getAttackMs(MON_SPEED)/1000; // 1.5s
const TTK_REF=4.0;              // common+0 avg class kills a normal in ~4s
const BUDGET=28;                // farm window -> ref kills = 28/4 = 7
const SURV_HITS=18;            // monster attack tuned so player survives ~18 hits (no-potion floor / no one-shot)
// monster rarity HP multipliers tuned for the kill ranges (normal 5-10, strong 3-8, epic 2-5, legend 1-3, boss 0-1)
const MONR={normal:{hp:1.0,atk:1.0},strong:{hp:1.4,atk:1.1},epic:{hp:2.0,atk:1.25},legendary:{hp:3.5,atk:1.4},boss:{hp:14,atk:1.6}};
// L<=10 = starter zone: calibrate to the NO-GEAR fresh player so a brand-new
// character (no drops yet) can farm the first monsters. L>10 assumes common+0 gear.
function ref(L){const ng=L<=10;const ps=CLASSES.map(c=>player(c,L,L,'common',0,ng));return{dps:ps.reduce((s,p)=>s+playerDPS(p,0),0)/7,maxHp:ps.reduce((s,p)=>s+p.maxHp,0)/7,def:ps.reduce((s,p)=>s+p.defense,0)/7};}
function calibMonster(L){const r=ref(L);return{hp:max(8,round(r.dps*TTK_REF)),attack:max(1,round(r.maxHp/SURV_HITS+r.def)),defense:max(1,round(r.def*0.15)),speed:MON_SPEED};}
function enemyAt(L,rarity){const b=calibMonster(L),R=MONR[rarity];return{hp:floor(b.hp*R.hp),attack:floor(b.attack*R.atk),defense:b.defense};}
function killsRate(p,L,rarity){const e=enemyAt(L,rarity);const ttk=e.hp/playerDPS(p,e.defense);return ttk>0?round(BUDGET/ttk):0;}
function killsNoPotion(p,L,rarity){const e=enemyAt(L,rarity);const ttk=e.hp/playerDPS(p,e.defense);const monHit=max(1,e.attack-p.defense)*1.05;if(monHit>=p.maxHp)return 0;const monDPS=monHit/MON_INT;const surv=p.maxHp/monDPS;return min(round(BUDGET/ttk),floor(surv/ttk));}

// ============================================================================
console.log('=== common+0, char=item=lvl — kills WITH potions (rate) per class/monster-rarity ===');
console.log('lvl | class       | normal strong epic legend boss');
for(const L of [10,100,500,1000]){for(const cls of CLASSES){const p=player(cls,L,L,'common',0);console.log(`${String(L).padStart(4)}| ${cls.padEnd(11)}| ${['normal','strong','epic','legendary','boss'].map(r=>String(killsRate(p,L,r)).padStart(5)).join(' ')}`);}console.log('');}
console.log('(target: normal 5-10 [DPS hi/support lo], strong 3-8, epic 2-5, legend 1-3, boss 0-1)');

console.log('\n=== L1 RAT, NO GEAR, NO potions — target 5-7 each class ===');
for(const cls of CLASSES){const p=player(cls,1,1,'common',0,true);console.log(`  ${cls.padEnd(11)}: ${killsNoPotion(p,1,'normal')} (rate ${killsRate(p,1,'normal')})`);}

console.log('\n=== USER EXAMPLES (L100 normal, WITH potions) ===');
const ex=(cls,R,U)=>killsRate(player(cls,100,100,R,U),100,'normal');
for(const cls of ['Mage','Knight','Bard']) console.log(`  ${cls.padEnd(7)}: common+0=${ex(cls,'common',0)}  rare+3=${ex(cls,'rare',3)}(~7.5-15)  legend+7=${ex(cls,'legendary',7)}(~11-21)  heroic+2=${ex(cls,'heroic',2)}(~11-22)`);

console.log('\n=== RARITY/UPGRADE scaling (Mage L100 normal) — ~+15%/rarity, +10%/upgrade, heroic+105% ===');
for(const R of['common','rare','epic','legendary','mythic','heroic'])console.log(`  ${R.padEnd(10)} +0:${ex('Mage',R,0)} +3:${ex('Mage',R,3)} +5:${ex('Mage',R,5)} +7:${ex('Mage',R,7)}`);

console.log('\n=== UNDER-LEVELED gear (L100 Knight, common+0 at gear-level G, normal) — spec L50->1-2, L1->0 ===');
for(const G of[100,90,75,50,25,1])console.log(`  gear L${G}: ${killsRate(player('Knight',100,G,'common',0),100,'normal')}`);

console.log('\n=== SANITY: Mage L15 epic+5 vs L15 STRONG (must be >0) ===');
console.log(`  Mage L15 epic+5 strong: ${killsRate(player('Mage',15,15,'epic',5),15,'strong')} kills`);

console.log('\n=== one-shot check: does any level-matched monster one-shot a common+0 player? ===');
let os=0;for(const L of[1,10,50,100,500,1000])for(const cls of CLASSES)for(const r of['normal','strong','epic','legendary','boss']){const p=player(cls,L,L,'common',0);const e=enemyAt(L,r);if(max(1,e.attack-p.defense)*2>=p.maxHp)os++;}
console.log(`  one-shot cells: ${os} (want 0)`);

if(APPLY){for(const m of monsters){const c=calibMonster(m.level);m.hp=c.hp;m.attack=c.attack;m.defense=c.defense;m.speed=c.speed;}writeFileSync(P('monsters.json'),JSON.stringify(monsters,null,2)+'\n');console.log('\nAPPLIED monsters.json. NOTE: also set itemTemplates rarityMultipliers + itemSystem enh to match (see RMULT/enh above).');}
else console.log('\n(dry run — --apply to write monsters.json)');

// ---- KILL TABLES (for review) ----
if(process.argv.includes('--table')){
  const gears=[['common',0],['common',5],['rare',3],['epic',5],['legendary',7],['mythic',7],['heroic',7]];
  console.log('\n\n############ ILE ZABIĆ — klasa × EQ (potwór NORMAL na swój poziom, z potionami) ############');
  for(const L of [50,100,500,1000]){
    console.log(`\n=== Poziom ${L} (potwór normal L${L}) ===`);
    console.log('Klasa'.padEnd(12)+gears.map(([r,u])=>`${r.slice(0,3)}+${u}`.padStart(8)).join(''));
    for(const cls of CLASSES) console.log(cls.padEnd(12)+gears.map(([r,u])=>String(killsRate(player(cls,L,L,r,u),L,'normal')).padStart(8)).join(''));
  }
  console.log('\n\n############ MONSTER-RARITY × EQ (poziom 100) — przykład Mage (DPS) i Knight (tank) ############');
  for(const cls of ['Mage','Knight']){
    console.log(`\n=== ${cls} L100 ===`);
    console.log('EQ'.padEnd(12)+['normal','strong','epic','legend','boss'].map(s=>s.padStart(8)).join(''));
    for(const [r,u] of gears) console.log(`${r.slice(0,4)}+${u}`.padEnd(12)+['normal','strong','epic','legendary','boss'].map(mr=>String(killsRate(player(cls,100,100,r,u),100,mr)).padStart(8)).join(''));
  }
}
