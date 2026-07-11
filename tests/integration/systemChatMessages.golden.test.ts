import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    isUpgradeMilestone,
    formatSystemMessage,
    parseSystemMessage,
    type TSystemMessagePayload,
} from '../../src/systems/systemChatMessages';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla systemChatMessages.
//
// systemChatMessages to PROTOKÓŁ czatu systemowego (nie UI): format + parse
// wiadomości `[SYS]{...json...}` przesyłanych po drucie. Wszystkie trzy funkcje
// są CZYSTE i DETERMINISTYCZNE (bez RNG, bez Date, bez store) → golden bit-parity
// na stringach (łącznie z polskimi znakami, slashami, cudzysłowami, escapami).
//
// Dwie role (jak levelSystem/lootSystem):
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/systemChatMessages.json z realnych funkcji.
//  2. Normalnie → GUARD: asertuje, że commitowany fixture == aktualny output TS.
//     Zmiana formatu/parsera w TS bez regeneracji → ten test zczerwienieje.
//
// Fixture jest kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/
// systemChatMessages.json), gdzie Pest odtwarza go w PHP → parytet TS↔PHP.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/systemChatMessages.golden.test.ts
//   cp golden/systemChatMessages.json ../grimshade-backend/tests/Golden/fixtures/
//
// UWAGA parytet JSON: JSON.stringify NIE escape'uje unicode ani slashy i zachowuje
// kolejność wstawiania kluczy. PHP json_encode musi użyć
// JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES, żeby dać bajt-w-bajt to samo.
// ============================================================================

// isUpgradeMilestone: +5, +7 oraz każdy poziom ≥ +10. Brzegi wokół progów +
// zero i wartości ujemne (nie są milestone).
const MILESTONE_LEVELS = [-5, -1, 0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 50, 100, 1000];

// formatSystemMessage: reprezentatywne payloady OBU wariantów + brzegi escape'ów
// (polskie znaki, slash, cudzysłów, backslash, newline, tab, ujemny/zero level).
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

// parseSystemMessage: happy-path OBU wariantów, normalizacja (kolejność kluczy +
// odrzucone pola extra), plus WSZYSTKIE ścieżki null (brak markera, pusty/whitespace
// body, malformed JSON, prymitywy JSON, tablica, zły type, złe/brakujące pola typu).
const PARSE_CONTENTS: string[] = [
    // Happy path — obie warianty (round-trip przez formatSystemMessage).
    '[SYS]{"type":"upgrade","itemId":"luk","rarity":"common","upgradeLevel":5,"itemName":"Krótki Łuk"}',
    '[SYS]{"type":"skillUpgrade","skillId":"power_strike","skillName":"Potężny Cios","upgradeLevel":10}',
    // Kolejność kluczy odwrócona → parser normalizuje do kolejności interfejsu.
    '[SYS]{"itemName":"Miecz","upgradeLevel":7,"rarity":"rare","itemId":"sword","type":"upgrade"}',
    // Pola extra są odrzucane (parser zwraca tylko kanoniczne pola).
    '[SYS]{"type":"skillUpgrade","skillId":"fire","skillName":"Ogień","upgradeLevel":12,"extra":"x","icon":"ikona"}',
    // Whitespace wokół JSON (marker + spacje/newline) → trim, parsuje się.
    '[SYS]  {"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1,"itemName":"c"}  ',
    '[SYS]\n{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1,"itemName":"c"}\n',
    // Poprawne liczby brzegowe (zero, ujemny) w upgradeLevel.
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":0,"itemName":"c"}',
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":-3,"itemName":"c"}',
    // Polskie znaki + slash w skillName zachowane.
    '[SYS]{"type":"skillUpgrade","skillId":"s","skillName":"Cios/Ćma","upgradeLevel":100}',

    // --- Ścieżki null ---
    'zwykła wiadomość bez markera',                 // brak markera
    '',                                             // pusty string (brak markera)
    '[SYS]',                                         // marker, puste body
    '[SYS]   ',                                      // marker, samo whitespace
    '[SYS]{"type":"upgrade","itemId":"a"',          // malformed JSON (ucięty)
    '[SYS]{nie-json}',                               // malformed JSON
    '[SYS]5',                                         // prymityw JSON (number)
    '[SYS]"hello"',                                  // prymityw JSON (string)
    '[SYS]null',                                      // prymityw JSON (null)
    '[SYS]true',                                       // prymityw JSON (bool)
    '[SYS][1,2,3]',                                    // tablica JSON
    '[SYS]{"type":"foo","itemId":"a"}',                // nieznany type
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":1}',            // brak itemName
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":"5","itemName":"c"}', // upgradeLevel string
    '[SYS]{"type":"upgrade","itemId":"a","rarity":"b","upgradeLevel":true,"itemName":"c"}', // upgradeLevel bool
    '[SYS]{"type":"upgrade","itemId":5,"rarity":"b","upgradeLevel":1,"itemName":"c"}',       // itemId number
    '[SYS]{"type":"skillUpgrade","skillId":"a","upgradeLevel":5}',                    // brak skillName
    '[SYS]{"type":"skillUpgrade","skillId":"a","skillName":"b"}',                     // brak upgradeLevel
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
        // Normalizacja przez JSON (wzór lootSystem) — usuwa ewentualne -0. Tu i tak
        // brak floatów, ale trzymamy konwencję guardu spójną między systemami.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
