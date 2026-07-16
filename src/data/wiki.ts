export interface IWikiStarterTip {
  icon: string;
  text: string;
  strong?: boolean;
}

export interface IWikiTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface IWikiSection {
  id: string;
  icon: string;
  title: string;
  summary: string;
  bullets: string[];
  tables?: IWikiTable[];
  note?: string;
}

export const WIKI_INTRO = {
  title: 'Grimshade — Wiki i poradnik',
  lead:
    'Grimshade to mobilna gra RPG, w której tworzysz bohatera jednej z 7 klas i rozwijasz go przez ' +
    'polowania, lochy, bossów, transformacje, arenę i wspólną grę z innymi. Ta strona to rozbudowany ' +
    'przewodnik: znajdziesz tu wszystko, co musisz wiedzieć na start, oraz opis każdego ekranu i systemu. ' +
    'Zacznij od „złotych zasad" poniżej — to one najbardziej przyspieszą Twój rozwój. :glowing-star:',
};

export const WIKI_STARTER_TIPS: IWikiStarterTip[] = [
  {
    icon: 'scroll',
    text:
      'ZAWSZE bierz taski (kontrakty na potwory) ZANIM zaczniesz walczyć. Task to zlecenie „zabij X potworów danego typu" ' +
      'z ogromną nagrodą XP i złota. Twoje zabójstwa liczą się do taska tylko wtedy, gdy jest on aktywny — ' +
      'polowanie bez aktywnego taska marnuje większość Twojego postępu.',
    strong: true,
  },
  {
    icon: 'scroll',
    text:
      'Możesz mieć kilka tasków naraz — do 2 aktywnych jednocześnie (licznik pokazuje „X/2"). Zanim wejdziesz w walkę, ' +
      'weź task na potwora, którego zamierzasz bić. Bez tasków rozwój jest BARDZO wolny i żmudny — pamiętaj o nich zawsze.',
    strong: true,
  },
  {
    icon: 'crossed-swords',
    text:
      'Gra sama toczy walkę — wybierasz potwora, klikasz „Walcz!", a bohater atakuje automatycznie. Twoja rola to dobrać ' +
      'cel na swój poziom, pilnować miksturek i skilli oraz w porę wyjść.',
  },
  {
    icon: 'test-tube',
    text:
      'Kupuj miksturki HP/MP na zapas i włącz auto-miksturki. Z miksturkami praktycznie się nie umiera — a śmierć boli ' +
      '(tracisz część poziomu i 25% doświadczenia umiejętności).',
  },
  {
    icon: 'crossed-swords',
    text:
      'Bij potwory na SWÓJ poziom i trzymaj ekwipunek na bieżąco. Gdy Twój sprzęt jest mocno poniżej poziomu potwora, ' +
      'zadajesz dużo mniej obrażeń (kara za „lukę w gearze"). Sprzęt na poziomie = pełna moc.',
  },
  {
    icon: 'glowing-star',
    text:
      'Rób questy i codzienne misje (Daily od 25 poziomu) — dają złoto, eliksiry, kamienie i punkty statystyk. ' +
      'Fioletowa kropka na ikonie zadań oznacza, że masz nagrodę do odebrania.',
  },
];

export const WIKI_SECTIONS: IWikiSection[] = [
  {
    id: 'postac-i-pasek',
    icon: 'elf',
    title: 'Twoja postać i górny pasek',
    summary: 'Górny pasek pokazuje najważniejsze informacje o postaci — masz go zawsze pod ręką.',
    bullets: [
      'Czerwony pasek to HP (życie), niebieski to MP (mana na zaklęcia). Kliknij je, by zobaczyć dokładne wartości.',
      'Kropka przy awatarze: zielona = jesteś online, czerwona = tryb offline.',
      'Złoto (gp / k / cc / sc) widać po prawej — kliknij, by zobaczyć dokładną kwotę i rozbicie na tiery.',
      'Skróty złota: 1 k = 1 000, 1 cc = 100 000, 1 sc = 10 000 000 gp.',
      'Ikona :sparkles: z liczbą = aktywne buffy/eliksiry. Kliknij, by zobaczyć co działa i ile czasu zostało.',
      'Fioletowa kropka na ikonie zadań = masz nagrodę do odebrania w Questach/Taskach.',
      'Kliknij awatar w lewym rogu, by otworzyć menu konta (język, tryb gry, synchronizacja, ta Wiki, wylogowanie).',
    ],
  },
  {
    id: 'miasto',
    icon: 'castle',
    title: 'Miasto (główny ekran)',
    summary: 'Miasto to centrum gry — stąd wchodzisz do wszystkich trybów i tu odpoczywasz.',
    bullets: [
      'Na górze widzisz kartę postaci: awatar, poziom, paski HP/MP/XP.',
      'Jeśli masz wolne punkty statystyk, pojawi się przycisk „+N statystyk do rozdania" → prowadzi do ekranu Postać.',
      'Kafelki na dole to skróty: Offline Trening, Depozyt, Market, Potwory, Odpoczynek, Rankingi, Śmierci.',
      'Odpoczynek: kliknij, by w ~10 sekund uleczyć HP i MP do maksimum (za darmo, tylko w mieście).',
      'Odpoczynku nie da się użyć w trakcie walki — najpierw ją zakończ.',
      'Na dole ekranu masz pasek nawigacji: Walka, Questy, Postać, Miasto, Społeczność, Sklep.',
    ],
  },
  {
    id: 'taski',
    icon: 'scroll',
    title: 'Taski — kontrakty na potwory (system nr 1!)',
    summary:
      'Taski to najważniejszy sposób zdobywania XP i złota. Zawsze bierz task na potwora, ZANIM zaczniesz go bić.',
    bullets: [
      'Task to zlecenie „zabij X potworów danego typu". Kliknij potwora → „Rozpocznij task", potem poluj.',
      'Zabójstwa liczą się do taska TYLKO gdy jest aktywny — dlatego bierz task przed walką, nie po.',
      'Możesz mieć do 2 aktywnych tasków naraz (licznik „X/2"). Tego samego potwora nie weźmiesz dwa razy jednocześnie.',
      'Każdy potwór ma 10 progów zabójstw: 10, 50, 100, 200, 500, 1000, 2500, 5000, 10000 i 100000.',
      'Nagrodę zawsze trzeba odebrać ręcznie („Odbierz nagrodę") — sama nie wpadnie.',
      'Rzadsze wersje potwora liczą się za więcej: silny = 3, epicki = 10, legendarny = 50, boss = 200 zwykłych zabójstw.',
      'Nagroda z taska to zwykle wartość 2–3 poziomów postaci na niskich/średnich poziomach — dlatego są tak ważne.',
    ],
    tables: [
      {
        caption: 'Przykładowe progi zabójstw i mniej-więcej ile poziomów daje jeden task ×1000 zabójstw:',
        headers: ['Poziom gracza', 'Task ×1000 (przykład)', 'Nagroda XP', 'Ile to poziomów'],
        rows: [
          ['~20', 'Mroczny elf ×1000', '≈ 61 500', '≈ 2,3 poziomu'],
          ['~50', 'Wielki demon ×1000', '≈ 313 500', '≈ 2,9 poziomu'],
          ['~100', 'Piekielny lord ×1000', '≈ 676 500', '≈ 2,2 poziomu'],
          ['~200', 'Tytan chaosu ×1000', '≈ 1 465 500', '≈ 0,2 poziomu (od tu XP rośnie stromo)'],
        ],
      },
    ],
    note:
      'Reguła na całą grę: nowy potwór do bicia = najpierw weź na niego task. Granie bez tasków jest wielokrotnie wolniejsze.',
  },
  {
    id: 'polowanie',
    icon: 'crossed-swords',
    title: 'Polowanie (walka z potworami)',
    summary: 'Podstawowy tryb zdobywania XP, złota i przedmiotów — walka toczy się automatycznie.',
    bullets: [
      'Wybierz potwora z listy i kliknij „Walcz!" — walka startuje sama, postać atakuje automatycznie.',
      'Tempo walki: x1 / x2 / x4 (szybsze przewijanie) oraz SKIP (natychmiastowy wynik, tylko solo, bez złota i dropów).',
      'Skille (zaklęcia) mogą rzucać się same (tryb auto) albo ręcznie (klikasz je sam) — każdy kosztuje MP i ma cooldown.',
      'Miksturki HP/MP są zawsze widoczne na dole — pij ręcznie lub ustaw auto-miksturki (4 sloty).',
      'Możesz walczyć z falą do 4 potworów naraz (przycisk „Dodaj potwora").',
      'W polowaniu „Wyjdź" kończy walkę bez kary — ale jeśli ZGINIESZ, tracisz część postępu (patrz sekcja o śmierci).',
      'Pamiętaj: przed polowaniem weź task na tego potwora, żeby zabójstwa liczyły się do nagrody.',
    ],
  },
  {
    id: 'bossowie',
    icon: 'ogre',
    title: 'Bossowie',
    summary: 'Pojedyncze, mocne starcia z bossami — duże nagrody, ale limit prób dziennie.',
    bullets: [
      'W grze jest kilkudziesięciu bossów rozstawionych na kolejnych progach poziomów (na wysokich poziomach zwykle co 25) — są dużo silniejsi niż zwykłe potwory.',
      'Masz 3 próby dziennie na każdego bossa (reset o północy; próby można odnowić eliksirem „Reset Bossa").',
      'Poniżej 30% HP boss wpada w szał (enrage) i zadaje więcej obrażeń — bądź gotów.',
      'Przed walką możesz dobrać botów do pomocy (do drużyny 4-osobowej).',
      'Walka jak w polowaniu: auto-atak, skille, miksturki, tempo x1/x2/x4 (bez SKIP).',
      '„Ucieknij" daje lekką karę (bez utraty przedmiotów); śmierć daje pełną karę.',
    ],
    note:
      'Orientacyjny balans solo z miksturkami: klasy DPS pokonują bossa mając sprzęt ok. legendarny +3, klasy wsparcia ' +
      '(Bard/Kleryk) ok. mityczny +3. Sprzęt heroiczny +7 zamyka bossów bardzo szybko.',
  },
  {
    id: 'lochy',
    icon: 'derelict-house',
    title: 'Lochy (Dungeon)',
    summary: 'Wielofalowy tryb (3–10 fal) zakończony bossem — masz 5 prób dziennie na loch.',
    bullets: [
      'Każda fala to 1–4 potwory; ostatnia fala to walka z bossem lochu.',
      'Po pierwszym przejściu loch dostaje znaczek „ukończony" (zostaje na stałe).',
      'Walka jak zwykle: auto-atak, skille, miksturki, tempo x1/x2/x4.',
      '„Ucieknij" w trakcie = lekka kara; po wygranej klikasz „Odbierz" po nagrody.',
      'Im wyższy poziom lochu, tym silniejsze potwory i lepsze łupy.',
      'Zabójstwa w lochu liczą się do tasków, questów i mastery.',
      'Loch ma minimalny poziom wejścia — jeśli jesteś za niski, przycisk wejścia jest zablokowany.',
    ],
  },
  {
    id: 'rajdy',
    icon: 'dragon',
    title: 'Rajdy (Raid)',
    summary: 'Endgame dla drużyny — fale potworów bossowej klasy, 5 prób dziennie.',
    bullets: [
      'Rajd wymaga drużyny (gracze lub boty) — nie zrobisz go w pełni solo.',
      'Tylko lider drużyny rozpoczyna rajd przyciskiem „Wejdź".',
      'Liczba fal rośnie z poziomem rajdu (1 fala na niskich, do 5 na najwyższych).',
      'Każdy członek drużyny losuje własne łupy; XP dzieli się z całą drużyną.',
      'Ukończenie rajdu daje gwarantowany bonusowy przedmiot.',
      'Rajdy są niedostępne w trybie offline (to tryb multiplayer).',
    ],
  },
  {
    id: 'transformacje',
    icon: 'fire',
    title: 'Transformacje',
    summary: 'Quest fabularny: pokonaj wszystkie potwory z danego zakresu poziomów i zdobądź trwałe bonusy.',
    bullets: [
      'Transformacje odblokowujesz po kolei; obejmują zakresy poziomów aż do 1000.',
      'W każdej walce pojawia się fala 4 potworów (Zwykły, Silny, Epicki, Boss).',
      'Po pokonaniu wszystkich potworów z zakresu klikasz „Zgarnij nagrody".',
      'Nagrody: mityczna broń dla Twojej klasy + eliksiry + miksturki + kamienie.',
      'Transformacja daje TRWAŁE bonusy do statystyk (HP, MP, atak, obrażenia) i nowy wygląd awatara.',
      'Postęp questa nie znika po ucieczce — możesz wrócić i dokończyć później.',
      'Ostatnia transformacja (poziomy 901–1000) ma potężny skok trudności — to najtrudniejsza walka w grze.',
    ],
  },
  {
    id: 'arena',
    icon: 'stadium',
    title: 'Arena (PvP)',
    summary: 'Tygodniowa liga 1v1 przeciw innym graczom i botom — walczysz o pozycję i nagrody sezonowe.',
    bullets: [
      'Masz 10 ataków dziennie. Sezon trwa tydzień (od poniedziałku do poniedziałku).',
      'Klikasz „Walcz" i wybierasz przeciwnika z pobliskich pozycji w rankingu.',
      'Walka jest turowa i automatyczna — używana jest „migawka" Twoich statystyk.',
      'Wygrana daje punkty ligi (LP) i punkty areny (AP); przegrana w ataku nie odbiera punktów.',
      'Awansujesz lub spadasz między ligami (od brązu do legendy) na koniec sezonu.',
      'Punkty AP wydajesz w sklepie areny (kamienie, miksturki, nawet mityczna broń); nagrody sezonowe odbierasz przyciskiem „Odbierz nagrody".',
      'Arena jest niedostępna w trybie offline.',
    ],
  },
  {
    id: 'trener',
    icon: 'bullseye',
    title: 'Trener (poligon)',
    summary: 'Bezpieczny pokój treningowy do testowania obrażeń, skilli i buffów na nieśmiertelnych manekinach.',
    bullets: [
      'Manekiny są nieśmiertelne — nie da się ich zabić, służą do testów.',
      'Włącz auto-atak, auto-skille, „trener atakuje" lub „bez cooldownów" przełącznikami.',
      'Licznik obrażeń pokazuje Twój DPS (najlepsze 5-sekundowe okno).',
      'Możesz testować leczenie i wskrzeszanie sojuszników w drużynie.',
      'Brak XP, złota i łupów — to tylko piaskownica.',
      'Uwaga: wyjście przez „Ucieknij" mimo wszystko nalicza karę za ucieczkę.',
    ],
  },
  {
    id: 'ekwipunek',
    icon: 'backpack',
    title: 'Ekwipunek — sprzęt i statystyki',
    summary: 'Tu zakładasz przedmioty, zarządzasz plecakiem i rozdajesz punkty statystyk.',
    bullets: [
      'Masz 12 slotów sprzętu: broń, lewa ręka (off-hand), hełm, naramienniki, zbroja, rękawice, spodnie, buty, 2 pierścienie, naszyjnik i kolczyki.',
      'Każda klasa nosi tylko swój typ broni i zbroi — niepasujące przedmioty się nie założą.',
      'Jest 6 rzadkości. Im wyższa, tym mocniejszy przedmiot i więcej losowych bonusów.',
      'Plecak mieści 1000 przedmiotów; poziom przedmiotu zwykle ogranicza, kto może go założyć.',
      'Punkty statystyk (2 za każdy poziom) rozdajesz na: +5 HP, +5 MP, +1 atak lub +1 obrona za punkt.',
      'Nadmiarowe/słabe przedmioty możesz rozłożyć na kamienie (20% szansy na kamień) — pojedynczo lub masowo.',
      'Auto-sprzedaż i auto-rozkład: włącz wybrane rzadkości, a loot z walki będzie automatycznie sprzedawany lub rozkładany na kamienie zaraz po wypadnięciu. Możesz ustawić „do lvl" — limit poziomu przedmiotu (0 = bez limitu), więc np. rozkładasz tylko niski loot, a lepszy zostaje w plecaku.',
    ],
    tables: [
      {
        caption: 'Rzadkości: mnożnik statystyk (× bazy) i liczba losowych bonusów:',
        headers: ['Rzadkość', 'Mnożnik statystyk', 'Losowe bonusy'],
        rows: [
          ['Zwykły (common)', '1,00×', '0'],
          ['Rzadki (rare)', '1,15×', '1'],
          ['Epicki (epic)', '1,30×', '1'],
          ['Legendarny (legendary)', '1,45×', '2'],
          ['Mityczny (mythic)', '1,60×', '3'],
          ['Heroiczny (heroic)', '2,05×', '5'],
        ],
      },
    ],
    note:
      'Heroiczny sprzęt ma około dwukrotnie mocniejszą bazę niż zwykły tego samego poziomu — to najlepszy tier w grze ' +
      'i wypada tylko z potworów, na których masz mastery 25.',
  },
  {
    id: 'ulepszanie',
    icon: 'hammer',
    title: 'Ulepszanie przedmiotów i kamienie',
    summary: 'Podnoś sprzęt od +1 do +30. Każdy poziom to +10% do statystyk bazowych — ale rośnie koszt i ryzyko.',
    bullets: [
      'Ulepszenie działa liniowo: +1 = +10%, +5 = +50%, +10 = +100% (×2), +30 = +300% (×4) statystyk bazowych.',
      'Ulepszasz kamieniami pasującymi do rzadkości przedmiotu (zwykły kamień do zwykłego itd.) + złotem.',
      'Wraz z poziomem rośnie liczba kamieni, koszt złota i spada szansa powodzenia.',
      'Porażka zabiera złoto i kamienie, ale NIE niszczy przedmiotu ani nie obniża jego poziomu.',
      'Sprzedaż zwraca 100% złota I kamieni włożonych w ulepszenia — udane ulepszanie nigdy nie jest stratą.',
      'Kamienie łączysz w wyższe: 100 niższych + 1000 złota → 1 wyższego tieru.',
      'Rzadsze przedmioty (od rzadkiego wzwyż) możesz „przelosować" bonusy za 2 kamienie.',
    ],
    tables: [
      {
        caption: 'Koszt i szansa powodzenia ulepszenia (wybrane poziomy):',
        headers: ['Poziom', 'Kamienie', 'Złoto', 'Szansa'],
        rows: [
          ['+1', '1', '100', '100%'],
          ['+3', '2', '2 000', '60%'],
          ['+5', '5', '15 000', '30%'],
          ['+7', '12', '150 000', '15%'],
          ['+10', '50', '5 000 000', '2%'],
          ['+15', '180', '35 000 000', '0,3%'],
          ['+20', '580', '200 000 000', '0,01%'],
        ],
      },
    ],
  },
  {
    id: 'depozyt',
    icon: 'file-cabinet',
    title: 'Depozyt (skrytka)',
    summary: 'Bezpieczna skrytka na przedmioty — to, co tu schowasz, NIE przepada po śmierci.',
    bullets: [
      'Przenieś przedmiot z plecaka do depozytu przyciskiem „Do depozytu".',
      'Przedmioty w depozycie są bezpieczne — śmierć ich nie zabiera.',
      'Wyjmujesz je z powrotem do plecaka przyciskiem „Wyciągnij".',
      'Depozyt mieści bardzo dużo przedmiotów (do 10000) — trzymaj tu cenne rzeczy zanim ich użyjesz.',
      'Depozyt przyjmuje tylko przedmioty sprzętu (nie miksturki ani kamienie — te mają własne stacki).',
    ],
  },
  {
    id: 'sklep',
    icon: 'shopping-cart',
    title: 'Sklep',
    summary: 'Kupujesz tu miksturki, eliksiry i podstawowy sprzęt za złoto.',
    bullets: [
      'Miksturki HP/MP: od małych (+50 HP / +30 MP) po procentowe (leczą % maks. HP/MP) — kupuj na zapas przed trudnymi walkami.',
      'Eliksiry XP i Skilli: +50% lub +100% doświadczenia; premium ×2 na 12 godzin. Działają na WSZYSTKIE źródła XP (polowanie, taski, questy, lochy, bossy, rajdy, transformy, offline), a czas leci realnie od momentu użycia — nie pauzuje poza walką.',
      'Eliksiry bojowe: +% obrażeń, ataku, obrony, prędkości ataku, +max HP/MP — działają w walce, zwykle 15 minut.',
      'Eliksir Ochrony przed Śmiercią chroni poziomy i statystyki; Amulet Strat chroni przedmioty (1 użycie).',
      'Resety lochów/bossów odnawiają dzienne próby (limit 5 zakupów dziennie każdego).',
      'Wyższe miksturki i eliksiry mają wymagany poziom postaci.',
      'W „Alchemii" łączysz słabsze miksturki w mocniejsze (bez kosztu złota).',
    ],
  },
  {
    id: 'rynek',
    icon: 'money-bag',
    title: 'Rynek (handel między graczami)',
    summary: 'Kupuj i sprzedawaj przedmioty innym graczom — gospodarka napędzana przez społeczność.',
    bullets: [
      'Wystawiasz przedmiot na sprzedaż, ustalając cenę w złocie.',
      'Od sprzedaży pobierany jest podatek 5% — resztę dostaje sprzedający.',
      'Handlować można sprzętem, miksturkami, eliksirami, kamieniami, punktami areny i skrzyniami czarów.',
      'Kupione przedmioty trafiają prosto do plecaka.',
      'Złoto ze sprzedaży odbierasz przez powiadomienia o sprzedaży.',
      'Anulowanie oferty zwraca przedmiot do plecaka.',
      'Rynek jest niedostępny w trybie offline.',
    ],
  },
  {
    id: 'czary-skille',
    icon: 'magic-wand',
    title: 'Czary i umiejętności — jak zdobywać spelle',
    summary:
      'Każda klasa ma 15 własnych czarów. Nie dostajesz ich automatycznie — odblokowujesz je za Skrzynie Czarów i złoto.',
    bullets: [
      'Czary odblokowują się na poziomach: 5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000.',
      'Aby odblokować czar, potrzebujesz Skrzyni Czarów (Spell Chest) o poziomie tego czaru + trochę złota.',
      'Skrzynie Czarów zdobywasz z łupów, questów i handlu — trzymają się jako osobne stacki w plecaku.',
      'Masz 4 sloty na aktywne czary — wybierasz, których 4 używasz w walce (tego samego nie wstawisz dwa razy).',
      'Czary rzucają się automatycznie (tryb auto) lub ręcznie; każdy kosztuje MP i ma cooldown.',
      'Czary możesz też ULEPSZAĆ (za Skrzynie Czarów + złoto) — wyższy poziom = większe obrażenia czaru, ale szansa powodzenia spada.',
      'Efekty czarów to m.in. obrażenia obszarowe (AOE), ogłuszenie, przebicie obrony, leczenie drużyny, przywołania, dobicie wroga poniżej progu HP.',
    ],
    note:
      'Instant-kill (natychmiastowe zabicie) jest ograniczone do 12% maks. HP celu — nie ma już „one-shotowania" bossów. ' +
      'Efekty „dobij poniżej X% HP" nadal działają jako pełne wykończenie.',
  },
  {
    id: 'poziom-broni',
    icon: 'dagger',
    title: 'Poziom broni / Magic Level',
    summary:
      'Osobny system rozwoju: każda klasa ma umiejętność broni (lub Magic Level / Bard Level), która rośnie od używania.',
    bullets: [
      'Klasy bronią (Rycerz, Łucznik, Łotr, Bard) rozwijają umiejętność broni ze zwykłych ataków.',
      'Klasy magiczne (Mag, Kleryk, Nekromanta) rozwijają Magic Level z ataków i rzucania czarów.',
      'Rycerz ma dodatkowo „Shielding" — rośnie od blokowania ataków i daje więcej obrony oraz szansy na blok.',
      'Każdy poziom umiejętności broni to stały bonus do obrażeń (4–8% na poziom, zależnie od klasy), aż do poziomu 100.',
      'Umiejętności możesz też trenować u Trenera i offline (trening offline do 24 godzin).',
      'Poziomy broni mają własne zakładki w rankingu (Miecz, Sztylet, Dystans, Magic Level, Bard, Shielding).',
    ],
  },
  {
    id: 'mastery',
    icon: 'glowing-star',
    title: 'Mastery i „punkty masterii"',
    summary: 'Każdy potwór ma własny poziom mistrzostwa (0–25) za wielokrotne zabijanie — to długoterminowy cel.',
    bullets: [
      'Mastery rośnie, gdy zabijasz danego potwora. Pierwszy poziom wymaga 5000 zabójstw, każdy kolejny o 5000 więcej.',
      'Rzadsze wersje liczą się za więcej (silny 3, epicki 10, legendarny 50, boss 200 — tak samo jak w taskach).',
      'Każdy poziom mastery daje +2% XP i +2% złota z tego potwora (maks. +50% na poziomie 25).',
      'Wyższe mastery zwiększa szansę na rzadsze wersje potwora (silny/epicki/legendarny/mityczny).',
      'Maksymalne mastery (25) odblokowuje szansę na przedmioty HEROICZNE z tego potwora.',
      'Mastery ≥ 1 na potworze odblokowuje kolejnego, silniejszego potwora na liście.',
      '„Punkty masterii" (mastery_points) w rankingu to suma poziomów mastery ze wszystkich potworów — rosną automatycznie, nie wydaje się ich.',
    ],
    note:
      'Uwaga: „mastery" (per-potwór 0–25) to co innego niż „poziom broni / Magic Level" (0–100). Pierwsze zdobywasz zabijając ' +
      'konkretnego potwora, drugie — używając broni/czarów.',
  },
  {
    id: 'klasy',
    icon: 'busts-in-silhouette',
    title: 'Klasy postaci (7)',
    summary: 'Każda z 7 klas ma inne statystyki bazowe, broń i styl gry. Na koncie zmieścisz do 7 postaci.',
    bullets: [
      'Rycerz — twardy tank z tarczą, jako jedyny blokuje ataki i chroni drużynę.',
      'Mag — najwyższe obrażenia magiczne (mnożnik 1,3×), ale mało HP.',
      'Kleryk — leczenie i wsparcie drużyny, dużo many.',
      'Łucznik — zasięgowy, może osiągnąć 100% szansy na krytyk, potrafi unikać.',
      'Łotr — walczy dwoma sztyletami, wysoki krytyk (do 100%) i uniki.',
      'Nekromanta — przyzywa sługi (szkielety, duchy, demony, licza), które przyjmują obrażenia i dobijają wrogów.',
      'Bard — wsparcie: pieśni dają całej drużynie bonusy do ataku, prędkości i krytyka.',
    ],
    tables: [
      {
        caption: 'Orientacyjne statystyki bazowe (poziom 1) i przyrost HP/MP na każdy poziom:',
        headers: ['Klasa', 'HP baz.', 'MP baz.', 'HP / poziom', 'MP / poziom', 'Rola'],
        rows: [
          ['Rycerz', '200', '50', '+8', '+2', 'Tank / obrona'],
          ['Mag', '100', '200', '+3', '+8', 'Obrażenia magiczne'],
          ['Kleryk', '130', '160', '+5', '+6', 'Leczenie / wsparcie'],
          ['Łucznik', '120', '80', '+4', '+3', 'Zasięg / krytyki'],
          ['Łotr', '110', '90', '+4', '+3', 'Podwójne sztylety / krytyki'],
          ['Nekromanta', '90', '220', '+3', '+9', 'Przyzwania'],
          ['Bard', '115', '130', '+4', '+5', 'Wsparcie / pieśni'],
        ],
      },
    ],
    note:
      'Oprócz przyrostu HP/MP co poziom, co 10 poziomów dostajesz dodatkowy skok statystyk. Atak i obronę ' +
      'rozwijasz głównie przez punkty statystyk (2 na poziom) i ekwipunek, więc startowe wartości szybko przestają mieć znaczenie.',
  },
  {
    id: 'zadania',
    icon: 'open-book',
    title: 'Questy i misje dzienne (Daily)',
    summary: 'Oprócz tasków są jednorazowe questy fabularne i codzienne misje — wszystkie dają nagrody do odebrania.',
    bullets: [
      'Questy: jednorazowe zadania z celami (zabij potwory, ukończ lochy, zdobądź mastery) i nagrodami. Bez limitu aktywnych.',
      'Nagrody questów: złoto (zawsze), często eliksiry, kamienie, punkty statystyk, czasem konkretny przedmiot lub XP.',
      'Wiele questów dorzuca dodatkowo losowy przedmiot dla Twojej klasy.',
      'Daily (misje dzienne): 12 zadań dziennie, odblokowane od 25 poziomu, reset o północy.',
      'Nagrody Daily rosną z Twoim poziomem (im wyższy poziom, tym większe złoto i XP).',
      'Nagrodę zawsze trzeba kliknąć („Odbierz") — sama nie wpadnie. Fioletowa kropka = coś czeka na odebranie.',
    ],
  },
  {
    id: 'poziomy-xp',
    icon: 'chart-increasing',
    title: 'Poziomy i doświadczenie',
    summary: 'Za każdy poziom dostajesz punkty statystyk oraz przyrost HP/MP. Krzywa XP rośnie wraz z poziomem.',
    bullets: [
      'Za każdy nowy poziom dostajesz 2 punkty statystyk oraz stały przyrost HP i MP zależny od klasy.',
      'Punkty i przyrosty dostajesz tylko za poziomy powyżej swojego rekordu — po śmierci i ponownym wbiciu nie dostaniesz ich drugi raz.',
      'XP potrzebne na kolejny poziom rośnie: na niskich poziomach szybko, powyżej 200 poziomu bardzo stromo.',
      'Poza taskami/questami XP zdobywasz z każdego zabójstwa (rzadsze wersje dają wielokrotnie więcej).',
      'Eliksiry XP i wysokie mastery dodatkowo zwiększają zdobywane doświadczenie.',
    ],
    tables: [
      {
        caption: 'Ile XP potrzeba na kolejny poziom (przykłady):',
        headers: ['Poziom', 'XP na kolejny poziom'],
        rows: [
          ['1', '300'],
          ['10', '≈ 9 500'],
          ['25', '37 500'],
          ['50', '≈ 106 000'],
          ['100', '300 000'],
          ['200', '≈ 7 330 000'],
          ['500', '≈ 66 300 000'],
          ['1000', '≈ 897 000 000'],
        ],
      },
    ],
  },
  {
    id: 'party',
    icon: 'handshake',
    title: 'Party (drużyna)',
    summary: 'Łącz siły z innymi graczami w drużynie do 4 osób, by walczyć razem.',
    bullets: [
      'Drużyna liczy maksymalnie 4 osoby (gracze lub boty).',
      'Stwórz własną drużynę lub dołącz do publicznej z listy.',
      'Więcej osób = więcej XP i lepsze łupy, ale też silniejsi przeciwnicy.',
      'Drużyna z 3+ różnymi klasami dostaje dodatkowy bonus do XP i złota.',
      'Tylko lider rozpoczyna walki (boss/rajd/trener) — pojawia się sprawdzenie gotowości.',
      'Klasy dają drużynie buffy (np. Kleryk leczy, Bard zwiększa atak i prędkość, Rycerz obronę).',
      'Party jest niedostępne w trybie offline.',
    ],
  },
  {
    id: 'gildia',
    icon: 'classical-building',
    title: 'Gildia',
    summary: 'Stały klan graczy ze wspólnym tagiem, czatem, skarbcem i tygodniowym bossem.',
    bullets: [
      'Założenie gildii kosztuje 1 000 000 złota; dostajesz tag (2–3 znaki) widoczny przy nicku.',
      'Gildia ma 20 miejsc na start i +1 miejsce za każdy zdobyty poziom.',
      'Tygodniowy boss gildii (tier 1–50) — zadane mu obrażenia dają XP gildii i Twój wkład.',
      'Im większy Twój wkład w bossa, tym lepsze indywidualne nagrody.',
      'Niedziela to dzień odbioru nagród — wtedy walka z bossem jest zablokowana.',
      'Gildia ma własny skarbiec na przedmioty i własny kanał czatu.',
    ],
  },
  {
    id: 'czat-znajomi',
    icon: 'speech-balloon',
    title: 'Czat i Znajomi',
    summary: 'Rozmawiaj z graczami na kanałach i zarządzaj listą znajomych oraz blokad.',
    bullets: [
      'Kanały czatu: Miasto (globalny), Drużyna, Gildia, prywatne wiadomości (PM) i System.',
      'Pływająca ikona czatu w prawym dolnym rogu — kropka oznacza nową wiadomość.',
      'Kliknij/przytrzymaj nick gracza, by dodać do znajomych, wysłać PM lub zablokować.',
      'Znajomi pokazują status online (aktywni w ostatnich 5 minutach) i można ich przypiąć (ulubieni).',
      'Zablokowany gracz: nie widzisz jego wiadomości, ale Ty wciąż możesz pisać do niego.',
      'Czat i znajomi działają tylko online (to funkcje multiplayer).',
    ],
  },
  {
    id: 'ranking',
    icon: 'trophy',
    title: 'Ranking (Leaderboard)',
    summary: 'Tabele najlepszych graczy w wielu kategoriach — sprawdź, jak wypadasz na tle innych.',
    bullets: [
      'Mnóstwo zakładek: poziom, umiejętności broni, bossy, mastery, arena, gildie i więcej.',
      'Każda tabela pokazuje top 100 graczy (lub gildii).',
      'Top 3 mają medale :1st-place-medal::2nd-place-medal::3rd-place-medal:; Twój wiersz jest podświetlony.',
      'Zakładki areny pokazują zabójców, ofiary i ranking ligowy.',
      'Ranking jest niedostępny w trybie offline.',
    ],
  },
  {
    id: 'smierci',
    icon: 'skull',
    title: 'Śmierci i kary',
    summary: 'Śmierć w walce boli — tracisz część postępu, dlatego warto się chronić.',
    bullets: [
      'Po śmierci tracisz „poziomy" w wysokości max(0,20 · poziom / 100) — np. na 50 lvl to pół poziomu, na 100 lvl 1 poziom, na 200 lvl 2 poziomy.',
      'Tracisz też 25% nazbieranego doświadczenia umiejętności (skill XP) — to zwykle boli najbardziej.',
      'Zdobyte wcześniej statystyki z poziomów NIE znikają — wracasz tylko niżej z poziomem i paskiem XP.',
      'Bez ochrony i powyżej 50 poziomu możesz też stracić część przedmiotów z plecaka (te w depozycie są bezpieczne).',
      'Eliksir Ochrony przed Śmiercią zeruje całą karę (poziom, XP, skille i przedmioty) — 1 użycie.',
      'Amulet Strat chroni przedmioty przed utratą — 1 użycie.',
      'Ucieczka (z bossa/lochu/rajdu) jest dużo lżejsza: ~10% kary śmierci, tylko 2,5% skill XP i nigdy nie zabiera przedmiotów.',
    ],
    note:
      'Zamknięcie karty w trakcie walki liczy się jak śmierć (z pełną karą) i pomija ochronę — nie da się tak uniknąć kary. ' +
      'Dlatego zawsze wychodź z walki przyciskiem „Wyjdź".',
  },
  {
    id: 'tryb-offline',
    icon: 'mobile-phone-off',
    title: 'Tryb offline',
    summary: 'Możesz grać bez połączenia — część trybów działa lokalnie, część jest wyłączona.',
    bullets: [
      'Działa offline: polowanie, lochy, bossy, transformacje, trener i offline trening.',
      'Wyłączone offline: Rynek, Rankingi, Śmierci, Party, Gildia, Czat, Znajomi, Rajd, Arena.',
      'Postęp zapisuje się lokalnie natychmiast — bezpieczny nawet po odświeżeniu strony.',
      'Gra startuje domyślnie online; tryb offline włączasz ręcznie w menu konta.',
      'Po utracie sieci gra sama przełącza się w offline, a po powrocie wraca online.',
      'Po powrocie online lokalny postęp synchronizuje się z chmurą.',
    ],
  },
  {
    id: 'offline-trening',
    icon: 'stopwatch',
    title: 'Offline trening (polowanie w tle)',
    summary: 'Zostaw postać na polowaniu, a ona zdobywa łupy nawet gdy nie grasz — potem odbierasz nagrody.',
    bullets: [
      'Uruchamiasz sesję na wybranym potworze; postać „poluje" w tle przez ograniczony czas.',
      'Po powrocie odbierasz zebrane XP, złoto i przedmioty jednym kliknięciem.',
      'System jest zabezpieczony przed duplikacją nagród (liczy się realny upływ czasu).',
      'Osobno działa też offline trening umiejętności (do 24 godzin) — rozwija poziomy broni/Magic Level.',
    ],
  },
  {
    id: 'konto',
    icon: 'bust-in-silhouette',
    title: 'Konto (menu awatara)',
    summary: 'Menu pod awatarem w górnym pasku — tu zarządzasz kontem i ustawieniami.',
    bullets: [
      'Zmień postać — wróć do wyboru postaci (możesz mieć do 7 postaci na koncie).',
      'Język — przełącznik polski / angielski.',
      'Tryb gry — przełącznik Online :green-circle: / Offline :red-circle:.',
      'Nie wygaszaj ekranu — ekran nie gaśnie podczas gry (kosztem baterii).',
      'Synchronizuj — ręcznie zapisuje postęp do chmury (pokazuje czas ostatniej synchronizacji).',
      'Zmień hasło :key: — podajesz obecne hasło, a potem nowe (dwa razy dla pewności).',
      'Wiki — otwiera tę stronę w nowej karcie w każdej chwili.',
      'Wyloguj — zapisuje postęp i wylogowuje z konta.',
    ],
  },
];
