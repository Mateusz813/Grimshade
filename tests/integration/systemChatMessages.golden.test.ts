import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    isUpgradeMilestone,
    formatSystemMessage,
    parseSystemMessage,
    type TSystemMessagePayload,
} from '../../src/systems/systemChatMessages';


const MILESTONE_LEVELS = [-5, -1, 0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 50, 100, 1000];

const FORMAT_PAYLOADS: TSystemMessagePayload[] = [
    { type: 'upgrade', itemId: 'luk', rarity: 'common', upgradeLevel: 5, itemName: 'Krótki Łuk' },
    { type: 'upgrade', itemId: 'wlocznia', rarity: 'legendary', upgradeLevel: 7, itemName: 'Włócznia Śmierci' },
    { type: 'upgrade', itemId: 'miecz', rarity: 'heroic', upgradeLevel: 30, itemName: 'Miecz "Zguba"' },
    { type: 'upgrade', itemId: 'sciezka', rarity: 'epic', upgradeLevel: 10, itemName: 'Path\\To\\Ostrze' },
    { type: 'upgrade', itemId: 'wielolinia', rarity: 'rare', upgradeLevel: 11, itemName: 'Linia\nDruga\tTab' },
    { type: 'upgrade', itemId: 'zero', rarity: 'common', upgradeLevel: 0, itemName: 'Kij' },
    { type: 'upgrade', itemId: 'ujemny', rarity: 'common', upgradeLevel: -3, itemName: 'Złamany Kij' },
    { type: 'skillUpgrade', skillId: 'power_strike', skillName: 'Potężny Cios', upgradeLevel: 10 },
    { type: 'skillUpgrade', skillId: 'slash', skillName: 'Cios/Ćma', upgradeLevel: 100 },
    { type: 'skillUpgrade', skillId: 'zero_skill', skillName: 'Iskra', upgradeLevel: 0 },
    { type: 'skillUpgrade', skillId: 'ognisty', skillName: 'Płomień Zagłady', upgradeLevel: 777 },
];

const PARSE_CONTENTS: string[] = [
    '[SYS]{"type":"upgrade","itemId":"luk","rarity":"common","upgradeLevel":5,"itemName":"Krótki Łuk"}',
    '[SYS]{"type":"skillUpgrade","skillId":"power_strike","skillName":"Potężny Cios","upgradeLevel":10}',
    '[SYS]{"itemName":"Miecz","upgradeLevel":7,"rarity":"rare","itemId":"sword","type":"upgrade"}',
    '[SYS]{"type":"skillUpgrade","skillId":"fire","skillName":"Ogień","upgradeLevel":12,"extra":"x","icon":"ikona"}',
    '[SYS]  {"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1,"itemName":"c"}  ',
    '[SYS]\n{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1,"itemName":"c"}\n',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":0,"itemName":"c"}',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":-3,"itemName":"c"}',
    '[SYS]{"type":"skillUpgrade","skillId":"s","skillName":"Cios/Ćma","upgradeLevel":100}',

    'zwykła wiadomość bez markera',
    '',
    '[SYS]',
    '[SYS]   ',
    '[SYS]{"type":"upgrade","itemId":"a"',
    '[SYS]{nie-json}',
    '[SYS]5',
    '[SYS]"hello"',
    '[SYS]null',
    '[SYS]true',
    '[SYS][1,2,3]',
    '[SYS]{"type":"foo","itemId":"a"}',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1}',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":"5","itemName":"c"}',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":true,"itemName":"c"}',
    '[SYS]{"type":"upgrade","itemId":5,"rarity":"b","upgradeLevel":1,"itemName":"c"}',
    '[SYS]{"type":"skillUpgrade","skillId":"a","upgradeLevel":5}',
    '[SYS]{"type":"skillUpgrade","skillId":"a","skillName":"b"}',
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'systemChatMessages',
    note: 'Generowane z src/systems/systemChatMessages.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',
    isUpgradeMilestone: MILESTONE_LEVELS.map((level) => ({ level, value: isUpgradeMilestone(level) })),
    formatSystemMessage: FORMAT_PAYLOADS.map((payload) => ({ payload, value: formatSystemMessage(payload) })),
    parseSystemMessage: PARSE_CONTENTS.map((content) => ({ content, value: parseSystemMessage(content) })),
});

const outPath = resolve(process.cwd(), 'golden/systemChatMessages.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('systemChatMessages golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current systemChatMessages output', () => {
        expect(existsSync(outPath), 'brak golden/systemChatMessages.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
