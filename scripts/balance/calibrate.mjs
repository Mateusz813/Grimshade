import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const require=createRequire(import.meta.url); const __dirname=dirname(fileURLToPath(import.meta.url));
const P=(f)=>join(__dirname,'../../src/data/',f);
const monsters=require(P('monsters.json')), itemTemplates=require(P('itemTemplates.json'));
const floor=Math.floor,max=Math.max,min=Math.min,round=Math.round;
const APPLY=process.argv.includes('--apply');

const CBS={Knight:{hp:150,mp:40,attack:12,defense:8,as:1.5,crit:0.03},Mage:{hp:90,mp:200,attack:9,defense:3,as:2.0,crit:0.05},Cleric:{hp:115,mp:155,attack:8,defense:6,as:2.0,crit:0.03},Archer:{hp:110,mp:80,attack:11,defense:4,as:2.5,crit:0.10},Rogue:{hp:100,mp:75,attack:10,defense:4,as:2.5,crit:0.15},Necromancer:{hp:88,mp:200,attack:9,defense:3,as:1.8,crit:0.05},Bard:{hp:105,mp:125,attack:9,defense:4,as:2.0,crit:0.07}};
const HPL={Knight:8,Mage:3,Cleric:5,Archer:4,Rogue:4,Necromancer:3,Bard:4};
const MILEHP={Knight:30,Mage:10,Cleric:15,Archer:15,Rogue:15,Necromancer:12,Bard:15};
const CLASSMOD={Knight:1.0,Mage:1.3,Cleric:1.0,Archer:1.2,Rogue:1.0,Necromancer:1.2,Bard:1.0};
const MAXCRIT={Knight:0.30,Mage:0.30,Cleric:0.30,Archer:1.0,Rogue:1.0,Necromancer:0.30,Bard:0.30};
const SKILLCOEF={Knight:0.5,Mage:0.8,Cleric:0.6,Archer:0.4,Rogue:0.3,Necromancer:0.8,Bard:0.5};
const TDMG=0.01, TATK=0.015;
const TFATK={Knight:9,Mage:13,Cleric:10,Archer:0,Rogue:15,Necromancer:12,Bard:10};
const tierSum=(n)=>{let s=0;for(let i=1;i<=n;i++)s+=1+(i-1)*0.3;return s;};
const ATTR_PCT=0.1, ATTR_INTERVAL=10;
const attrAtkMult=(L)=>1+floor(L/ATTR_INTERVAL)*(ATTR_PCT/100);
const ARMOR={Knight:'heavy',Mage:'magic',Cleric:'magic',Necromancer:'magic',Archer:'light',Rogue:'light',Bard:'light'};
const WEAPON={Knight:'sword',Mage:'staff',Cleric:'holy_wand',Archer:'bow',Rogue:'dagger',Necromancer:'dead_staff',Bard:'harp'};
const OFFH={Knight:'shield',Mage:'spellbook',Cleric:'holy_cross',Archer:'quiver',Rogue:'dagger',Necromancer:'voodoo_doll',Bard:'talisman'};
const CLASSES=Object.keys(CBS);

const RMULT={common:1.0,rare:1.15,epic:1.30,legendary:1.45,mythic:1.60,heroic:2.05};
const enh=(U)=>U<=0?1:1+U*0.10;
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
  const nTf=min(11,round(L/60)), tFlat=round(220*nTf*1.5), tHpPct=1+nTf*0.02, tDmg=1+nTf*TDMG;
  const tAtk=(atk+gA+round(TFATK[cls]*tierSum(nTf)))*(1+nTf*TATK)*attrAtkMult(L);
  return{cls,L,attack:round(tAtk),defense:def+gD,maxHp:round((hp+round(gH*GEAR_HP_SCALE)+tFlat)*tHpPct*attrAtkMult(L)),wRoll,csb,classMod:CLASSMOD[cls],crit:min(MAXCRIT[cls],b.crit),as:b.as,dual:cls==='Rogue',tDmg};
}
const getAttackMs=(s)=>max(500,floor(3000/max(1,s||1)));
const DMG_COMPRESS_K=2.3, DMG_COMPRESS_P=0.80, DEF_BASE=25, GEAR_HP_SCALE=0.25;
const compress=(x)=>DMG_COMPRESS_K*Math.pow(max(0,x),DMG_COMPRESS_P);
const mitig=(def,lvl)=>def<=0?0:min(0.75,def/(def+max(1,lvl)+DEF_BASE));
const SKILL_CD_S=20, SKILL_TIER=1.45, SKILL_UPG=1.16, SKILL_CRIT=0.20, DEFPEN_BOOST=1.10;
const SKILL_MULT=SKILL_TIER*SKILL_UPG*DEFPEN_BOOST*(1+SKILL_CRIT);
function basicRaw(p,enemyDef){
  const m=1-mitig(enemyDef,p.L);
  return compress((p.attack+(p.dual?0.6*p.wRoll:p.wRoll)+p.csb)*p.classMod*m)*(p.dual?2:1)*(p.tDmg||1);
}
function basicHit(p,enemyDef){return basicRaw(p,enemyDef)*(1+p.crit);}
const playerDPS=(p,enemyDef)=>basicHit(p,enemyDef)/(getAttackMs(p.as)/1000)+basicRaw(p,enemyDef)*SKILL_MULT/SKILL_CD_S;

const MON_SPEED=2.0, MON_INT=getAttackMs(MON_SPEED)/1000;
const HUNT_HITS=5.5;
const STARTER_BAND=25;
const HUNT_HITS_L1=3.2;
const SURV_HITS_L1=30;
const bandT=(L)=>min(1,max(0,(L-1)/(STARTER_BAND-1)));
const huntHitsAt=(L)=>HUNT_HITS_L1+(HUNT_HITS-HUNT_HITS_L1)*bandT(L);
const BUDGET=28;
const SURV_HITS=20;
const survHitsAt=(L)=>SURV_HITS_L1+(SURV_HITS-SURV_HITS_L1)*bandT(L);
const MONR={normal:{hp:1.0,atk:1.0},strong:{hp:1.5,atk:1.4},epic:{hp:2.5,atk:2.2},legendary:{hp:4.0,atk:3.2},boss:{hp:8.0,atk:5.0}};
const monDef=(L)=>max(1,round(L*0.29));
const refP=(L)=>player('Archer',L,L,'mythic',0,L<=10);
function calibMonster(L){const rp=refP(L),d=monDef(L);return{hp:max(8,round(basicRaw(rp,d)*huntHitsAt(L))),attack:max(1,round(rp.maxHp/survHitsAt(L))),defense:d,speed:MON_SPEED};}
function enemyAt(L,rarity){const b=calibMonster(L),R=MONR[rarity];return{hp:floor(b.hp*R.hp),attack:floor(b.attack*R.atk),defense:b.defense};}
function killsRate(p,L,rarity){const e=enemyAt(L,rarity);const ttk=e.hp/playerDPS(p,e.defense);return ttk>0?round(BUDGET/ttk):0;}
function killsNoPotion(p,L,rarity){const e=enemyAt(L,rarity);const ttk=e.hp/playerDPS(p,e.defense);const monHit=max(1,e.attack*(1-mitig(p.defense,L)))*1.05;if(monHit>=p.maxHp)return 0;const monDPS=monHit/MON_INT;const surv=p.maxHp/monDPS;return min(round(BUDGET/ttk),floor(surv/ttk));}

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
let os=0;for(const L of[1,10,50,100,500,1000])for(const cls of CLASSES)for(const r of['normal','strong','epic','legendary','boss']){const p=player(cls,L,L,'common',0);const e=enemyAt(L,r);if(max(1,e.attack*(1-mitig(p.defense,L)))*2>=p.maxHp)os++;}
console.log(`  one-shot cells: ${os} (want 0)`);

if(APPLY){for(const m of monsters){const c=calibMonster(m.level);m.hp=c.hp;m.attack=c.attack;m.defense=c.defense;m.speed=c.speed;}writeFileSync(P('monsters.json'),JSON.stringify(monsters,null,2)+'\n');console.log('\nAPPLIED monsters.json. NOTE: also set itemTemplates rarityMultipliers + itemSystem enh to match (see RMULT/enh above).');}
else console.log('\n(dry run — --apply to write monsters.json)');

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

if(process.argv.includes('--scale')){
  console.log('\n=== SUROWY top basic hit (vs 0 def), DMG_SCALE=1.0 — do ustawienia DMG_SCALE ===');
  const rows=[['common',0],['common',5],['legendary',7],['heroic',7],['heroic',30]];
  for(const L of [10,100,500,1000]){
    console.log(`\n  L${L}:`);
    for(const [r,u] of rows){let mx=0,mxCls='';for(const cls of CLASSES){const h=basicHit(player(cls,L,L,r,u),0);if(h>mx){mx=h;mxCls=cls;}}console.log(`    ${r.slice(0,4)}+${u}`.padEnd(14)+`max basic ≈ ${String(round(mx)).padStart(8)} (${mxCls})`);}
  }
  const top=(()=>{let mx=0;for(const cls of CLASSES)mx=max(mx,basicHit(player(cls,1000,1000,'heroic',7),0));return mx;})();
  console.log(`\n  TOP realistyczny (heroic+7 L1000) ≈ ${round(top)} → DMG_SCALE ≈ ${(1500/top).toFixed(4)} (basic ~1500, spell ~2× → ~3k)`);
}
