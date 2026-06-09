/**
 * In-game tutorial content for NEW players. Each entry is a game segment /
 * view, rendered by <TutorialModal> as a numbered, bold-titled section with a
 * one-line summary + short bullet points (NOT a wall of text).
 *
 * Source of truth for mechanics: `.claude/spec/*.md`. Keep this in sync when
 * a view's behavior changes (CLAUDE.md DOKUMENTACJA rule).
 *
 * NOTE: content is filled comprehensively below — one section per real view so
 * a brand-new user can read what every screen is for, what each button does,
 * and how to play.
 */

export interface ITutorialSection {
  /** Stable id (used as React key + E2E hook via data attr). */
  id: string;
  /** Emoji shown next to the numbered title. */
  icon: string;
  /** Bold section title, e.g. "Polowanie". */
  title: string;
  /** One short line: what this screen IS. */
  summary: string;
  /** Short how-to / what-each-button-does points. Keep each bullet tight. */
  bullets: string[];
}

export const TUTORIAL_SECTIONS: ITutorialSection[] = [
  {
    id: 'postac-i-pasek',
    icon: '🧝',
    title: 'Twoja postać i górny pasek',
    summary: 'Pasek na górze ekranu pokazuje najważniejsze informacje o postaci — masz go zawsze pod ręką.',
    bullets: [
      'Czerwony pasek to HP (życie), niebieski to MP (mana na zaklęcia). Kliknij je, by zobaczyć dokładne wartości.',
      'Kropka przy awatarze: zielona = jesteś online, czerwona = tryb offline.',
      'Pasek XP na karcie postaci pokazuje postęp do następnego poziomu (w %).',
      'Złoto (k / cc / sc) widać po prawej — kliknij, by zobaczyć dokładną kwotę.',
      'Ikona ✦ z liczbą = aktywne buffy/eliksiry. Kliknij, by zobaczyć co działa i ile czasu zostało.',
      'Fioletowa kropka na ikonie zadań = masz nagrodę do odebrania w Questach.',
      'Kliknij awatar w lewym rogu, by otworzyć menu konta.',
    ],
  },
  {
    id: 'miasto',
    icon: '🏰',
    title: 'Miasto (główny ekran)',
    summary: 'Miasto to centrum gry — stąd wchodzisz do wszystkich trybów i tu odpoczywasz.',
    bullets: [
      'Na górze widzisz kartę postaci: awatar, poziom, paski HP/MP/XP.',
      'Jeśli masz wolne punkty statystyk, pojawi się przycisk "+N statystyk do rozdania" → prowadzi do ekranu Postać.',
      'Kafelki na dole to skróty: Offline Trening, Depozyt, Market, Potwory, Odpoczynek, Rankingi, Śmierci.',
      'Odpoczynek: kliknij, by w ~10 sekund uleczyć HP i MP do maksimum (za darmo, tylko w mieście).',
      'Odpoczynku nie da się użyć w trakcie walki — najpierw zakończ walkę.',
      'Na dole ekranu masz pasek nawigacji: Walka, Questy, Postać, Miasto, Społeczność, Sklep.',
    ],
  },
  {
    id: 'polowanie',
    icon: '⚔️',
    title: 'Polowanie (walka z potworami)',
    summary: 'Podstawowy tryb zdobywania XP, złota i przedmiotów — walka toczy się automatycznie.',
    bullets: [
      'Wybierz potwora z listy i kliknij "Walcz!" — walka startuje sama, postać atakuje automatycznie.',
      'Tempo walki: x1 / x2 / x4 (szybsze przewijanie) oraz SKIP (natychmiastowy wynik, tylko solo, bez złota i mniej XP).',
      'Skille (zaklęcia) mogą rzucać się same (tryb auto) albo ręcznie (klikasz je sam) — każdy kosztuje MP i ma cooldown.',
      'Miksturki HP/MP są zawsze widoczne na dole — pij ręcznie lub ustaw auto-miksturki.',
      'Możesz walczyć z falą do 4 potworów naraz (przycisk "Dodaj potwora").',
      'W polowaniu nie ma ucieczki z karą — przycisk "Wyjdź" kończy walkę bez strat.',
      'Uwaga: jeśli zginiesz, tracisz część XP i poziomów (patrz sekcja o śmierci).',
    ],
  },
  {
    id: 'bossowie',
    icon: '👹',
    title: 'Bossowie',
    summary: 'Pojedyncze, mocne starcia z bossami — duże nagrody, ale limit prób dziennie.',
    bullets: [
      'Masz 3 próby dziennie na każdego bossa (potem trzeba czekać na reset).',
      'Bossowie są znacznie silniejsi niż zwykłe potwory (więcej HP, ataku, obrony).',
      'Poniżej 30% HP boss wpada w szał (enrage) i zadaje więcej obrażeń — bądź gotów.',
      'Przed walką możesz dobrać botów do pomocy (do drużyny 4-osobowej).',
      'Walka jak w polowaniu: auto-atak, skille, miksturki, tempo x1/x2/x4 (bez SKIP).',
      '"Ucieknij" daje tylko lekką karę (bez utraty przedmiotów); śmierć daje pełną karę.',
    ],
  },
  {
    id: 'lochy',
    icon: '🏚️',
    title: 'Lochy (Dungeon)',
    summary: 'Wielofalowy tryb (3-10 fal) zakończony bossem — masz 5 prób dziennie na loch.',
    bullets: [
      'Każda fala to 1-4 potwory; ostatnia fala to walka z bossem lochu.',
      'Po pierwszym przejściu loch dostaje znaczek "ukończony" (zostaje na stałe).',
      'Walka jak zwykle: auto-atak, skille, miksturki, tempo x1/x2/x4.',
      '"Ucieknij" w trakcie = lekka kara; po wygranej klikasz "Odbierz" po nagrody.',
      'Im wyższy poziom lochu, tym silniejsze potwory i lepsze łupy.',
      'Zabójstwa w lochu liczą się do tasków, questów i mastery.',
    ],
  },
  {
    id: 'rajdy',
    icon: '🐉',
    title: 'Rajdy (Raid)',
    summary: 'Endgame dla drużyny — fale po 4 potwory bossowej klasy, 5 prób dziennie.',
    bullets: [
      'Rajd wymaga drużyny (gracze lub boty) — nie zrobisz go w pełni solo.',
      'Tylko lider drużyny rozpoczyna rajd przyciskiem "Wejdź".',
      'Liczba fal rośnie z poziomem rajdu (1 fala na niskich, do 5 na najwyższych).',
      'Każdy członek drużyny losuje własne łupy; XP dzieli się z całą drużyną.',
      'Ukończenie rajdu daje gwarantowany bonusowy przedmiot.',
      'Rajdy są niedostępne w trybie offline (to tryb multiplayer).',
    ],
  },
  {
    id: 'transformacje',
    icon: '🔥',
    title: 'Transformacje',
    summary: 'Quest fabularny: pokonaj wszystkie potwory z danego zakresu poziomów i zdobądź trwałe bonusy.',
    bullets: [
      'Jest 11 transformacji (poziomy 30, 50, 100... do 1000) — odblokowujesz je po kolei.',
      'W każdej walce pojawia się fala 4 potworów (Zwykły, Silny, Epicki, Boss).',
      'Po pokonaniu wszystkich potworów z zakresu klikasz "Zgarnij nagrody".',
      'Nagrody: mityczna broń dla Twojej klasy + eliksiry + miksturki + kamienie.',
      'Transformacja daje TRWAŁE bonusy do statystyk (HP, MP, atak, obrażenia) i nowy wygląd awatara.',
      'Postęp questa nie znika po ucieczce — możesz wrócić i dokończyć później.',
    ],
  },
  {
    id: 'arena',
    icon: '🏟️',
    title: 'Arena (PvP)',
    summary: 'Tygodniowa liga 1v1 przeciw innym graczom i botom — walczysz o pozycję i nagrody sezonowe.',
    bullets: [
      'Masz 10 ataków dziennie. Sezon trwa tydzień (od poniedziałku do poniedziałku).',
      'Klikasz "Walcz" i wybierasz przeciwnika z pobliskich pozycji w rankingu.',
      'Walka jest turowa i automatyczna — używana jest "migawka" Twoich statystyk.',
      'Wygrana daje punkty ligi (LP) i punkty areny (AP); przegrana w ataku nie odbiera punktów.',
      'Awansujesz lub spadasz między ligami (od brązu do legendy) na koniec sezonu.',
      'Punkty AP wydajesz w sklepie areny; nagrody sezonowe odbierasz przyciskiem "Odbierz nagrody".',
      'Arena jest niedostępna w trybie offline.',
    ],
  },
  {
    id: 'trener',
    icon: '🎯',
    title: 'Trener (poligon)',
    summary: 'Bezpieczny pokój treningowy do testowania obrażeń, skilli i buffów na nieśmiertelnych manekinach.',
    bullets: [
      'Manekiny są nieśmiertelne — nie da się ich zabić, służą do testów.',
      'Włącz auto-atak, auto-skille, "trener atakuje" lub "bez cooldownów" przełącznikami.',
      'Licznik obrażeń pokazuje Twój DPS (najlepsze 5-sekundowe okno).',
      'Możesz testować leczenie i wskrzeszanie sojuszników w drużynie.',
      'Brak XP, złota i łupów — to tylko piaskownica.',
      'Uwaga: wyjście przez "Ucieknij" mimo wszystko nalicza karę za ucieczkę.',
    ],
  },
  {
    id: 'ekwipunek',
    icon: '🎒',
    title: 'Ekwipunek (Postać + Plecak)',
    summary: 'Tu zakładasz przedmioty, ulepszasz je i zarządzasz plecakiem oraz statystykami.',
    bullets: [
      'Masz 12 slotów ekwipunku (broń, off-hand, hełm, zbroja, spodnie itd.) — kliknij przedmiot i "Załóż".',
      'Każda klasa nosi tylko swój typ broni i zbroi — niepasujące przedmioty się nie założą.',
      'Ulepszanie: +1 do +30. Im wyżej, tym więcej kamieni i złota oraz mniejsza szansa powodzenia.',
      'Porażka ulepszania zabiera złoto i kamienie, ale NIE niszczy przedmiotu (poziom zostaje bez zmian).',
      'Rozkładanie przedmiotu (20% szansy na kamień) — pojedynczo lub masowo (zaznacz wiele).',
      'Sprzedaż zwraca też 100% kamieni i złota włożonych w ulepszenia — ulepszanie nigdy nie jest stratne.',
      'Punkty statystyk (gdy je masz) rozdajesz na 4 kafelkach: +5 HP, +5 MP, +1 atak lub +1 obrona za punkt.',
    ],
  },
  {
    id: 'depozyt',
    icon: '🗄️',
    title: 'Depozyt (skrytka)',
    summary: 'Bezpieczna skrytka na przedmioty — to, co tu schowasz, NIE przepada po śmierci.',
    bullets: [
      'Przenieś przedmiot z plecaka do depozytu przyciskiem "Do depozytu".',
      'Przedmioty w depozycie są bezpieczne — śmierć ich nie zabiera.',
      'Wyjmujesz je z powrotem do plecaka przyciskiem "Wyciągnij".',
      'Depozyt mieści dużo przedmiotów — trzymaj tu cenne rzeczy zanim ich użyjesz.',
      'Depozyt przyjmuje tylko przedmioty ekwipunku (nie miksturki ani kamienie).',
    ],
  },
  {
    id: 'sklep',
    icon: '🛒',
    title: 'Sklep',
    summary: 'Kupujesz tu miksturki, eliksiry i przedmioty za złoto.',
    bullets: [
      'Miksturki HP/MP — leczą życie lub manę; kupuj na zapas przed trudnymi walkami.',
      'Eliksiry XP — zwiększają zdobywane doświadczenie na określony czas.',
      'Eliksiry bojowe — chwilowe bonusy do obrażeń, ataku, obrony, prędkości ataku.',
      'Eliksir ochrony przed śmiercią — chroni przed utratą poziomów; Amulet Strat chroni przedmioty.',
      'Resety lochów/bossów — odnawiają dzienne próby (limit 5 dziennie).',
      'Niektóre przedmioty mają wymagany poziom postaci.',
    ],
  },
  {
    id: 'rynek',
    icon: '💰',
    title: 'Rynek (handel między graczami)',
    summary: 'Kupuj i sprzedawaj przedmioty innym graczom — gospodarka napędzana przez społeczność.',
    bullets: [
      'Wystawiasz przedmiot na sprzedaż, ustalając cenę w złocie.',
      'Od sprzedaży pobierany jest podatek 5% — resztę dostaje sprzedający.',
      'Kupione przedmioty trafiają prosto do plecaka.',
      'Złoto ze sprzedaży odbierasz przez powiadomienia o sprzedaży.',
      'Anulowanie oferty zwraca przedmiot do plecaka.',
      'Rynek jest niedostępny w trybie offline.',
    ],
  },
  {
    id: 'zadania',
    icon: '📜',
    title: 'Zadania, Taski i Daily',
    summary: 'Centrum questów: kontrakty na grind, jednorazowe questy fabularne i misje dzienne.',
    bullets: [
      'Taski: zabij X potworów danego typu (progi 10/50/100/200/500/1000) i odbierz nagrodę ręcznie.',
      'Questy: jednorazowe zadania fabularne z celami i nagrodami — bez limitu aktywnych.',
      'Daily (misje dzienne): 12 zadań dziennie, odblokowane od 25 poziomu, reset o północy.',
      'Nagrodę zawsze trzeba kliknąć ("Odbierz") — sama nie wpadnie.',
      'Rzadsze potwory liczą się za więcej zabójstw (np. boss = 200 zwykłych).',
      'Fioletowa kropka na ikonie Questów oznacza, że masz coś do odebrania.',
    ],
  },
  {
    id: 'mastery',
    icon: '🌟',
    title: 'Mastery (mistrzostwo na potworze)',
    summary: 'Każdy potwór ma własny poziom mistrzostwa (0-25) za jego wielokrotne zabijanie.',
    bullets: [
      'Mastery rośnie, gdy zabijasz danego potwora — to długoterminowy cel.',
      'Pierwszy poziom wymaga 5000 zabójstw, kolejne coraz więcej (5000 × kolejny poziom).',
      'Każdy poziom mastery daje +2% XP i +2% złota z tego potwora (do +50% na maksie).',
      'Wyższe mastery zwiększa szansę na rzadsze wersje potwora.',
      'Maksymalny poziom (25) odblokowuje szansę na przedmioty heroiczne z tego potwora.',
      'Mastery na potworze odblokowuje też kolejnego, silniejszego potwora na liście.',
    ],
  },
  {
    id: 'party',
    icon: '🤝',
    title: 'Party (drużyna)',
    summary: 'Łącz siły z innymi graczami w drużynie do 4 osób, by walczyć razem.',
    bullets: [
      'Drużyna liczy maksymalnie 4 osoby (gracze lub boty).',
      'Stwórz własną drużynę lub dołącz do publicznej z listy.',
      'Więcej osób = więcej XP i lepsze łupy, ale też silniejsi przeciwnicy.',
      'Drużyna z 3+ różnymi klasami dostaje dodatkowy bonus do XP i złota.',
      'Tylko lider rozpoczyna walki (boss/rajd/trener) — pojawia się sprawdzenie gotowości.',
      'Klasy dają drużynie buffy (np. Kleryk leczy, Bard zwiększa atak, Rycerz obronę).',
      'Party jest niedostępne w trybie offline.',
    ],
  },
  {
    id: 'gildia',
    icon: '🏛️',
    title: 'Gildia',
    summary: 'Stały klan graczy ze wspólnym tagiem, czatem, skarbcem i tygodniowym bossem.',
    bullets: [
      'Założenie gildii kosztuje 1 000 000 złota; dostajesz tag (2-3 znaki) widoczny przy nicku.',
      'Gildia ma 20 miejsc na start i +1 miejsce za każdy zdobyty poziom.',
      'Tygodniowy boss gildii (tier 1-50) — zadane mu obrażenia dają XP gildii i Twój wkład.',
      'Im większy Twój wkład w bossa, tym lepsze indywidualne nagrody.',
      'Niedziela to dzień odbioru nagród — wtedy walka z bossem jest zablokowana.',
      'Gildia ma własny skarbiec na przedmioty i własny kanał czatu.',
    ],
  },
  {
    id: 'czat-znajomi',
    icon: '💬',
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
    icon: '🏆',
    title: 'Ranking (Leaderboard)',
    summary: 'Tabele najlepszych graczy w wielu kategoriach — sprawdź, jak wypadasz na tle innych.',
    bullets: [
      'Mnóstwo zakładek: poziom, umiejętności broni, bossy, mastery, arena, gildie i więcej.',
      'Każda tabela pokazuje top 100 graczy (lub gildii).',
      'Top 3 mają medale 🥇🥈🥉; Twój wiersz jest podświetlony.',
      'Zakładki areny pokazują zabójców, ofiary i ranking ligowy.',
      'Ranking jest niedostępny w trybie offline.',
    ],
  },
  {
    id: 'smierci',
    icon: '💀',
    title: 'Śmierci i kary',
    summary: 'Śmierć w walce boli — tracisz część postępu, dlatego warto się chronić.',
    bullets: [
      'Po śmierci tracisz ~2% poziomów (np. 1 poziom na 50 lvl, 2 na 100 lvl) i bieżący pasek XP.',
      'Tracisz też 50% nazbieranego doświadczenia umiejętności (skill XP) — to boli najbardziej.',
      'Zdobyte wcześniej statystyki z poziomów NIE znikają — wracasz tylko niżej z XP.',
      'Bez ochrony możesz też stracić przedmioty z plecaka (te w depozycie są bezpieczne).',
      'Eliksir ochrony przed śmiercią — chroni przed utratą poziomów.',
      'Amulet Strat — chroni przed utratą przedmiotów.',
      'Ucieczka (z bossa/lochu/rajdu) daje dużo lżejszą karę niż śmierć i nie zabiera przedmiotów.',
    ],
  },
  {
    id: 'tryb-offline',
    icon: '📴',
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
    id: 'konto',
    icon: '👤',
    title: 'Konto (menu awatara)',
    summary: 'Menu pod awatarem w górnym pasku — tu zarządzasz kontem i ustawieniami.',
    bullets: [
      'Zmień postać — wróć do wyboru postaci (możesz mieć do 7 postaci na koncie).',
      'Język — przełącznik polski / angielski.',
      'Tryb gry — przełącznik Online 🟢 / Offline 🔴.',
      'Synchronizuj — ręcznie zapisuje postęp do chmury (pokazuje czas ostatniej synchronizacji).',
      'Zmień hasło 🔑 — podajesz obecne hasło, a potem nowe (dwa razy dla pewności).',
      'Tutorial — otwiera ten przewodnik w każdej chwili.',
      'Wyloguj — zapisuje postęp i wylogowuje z konta.',
    ],
  },
];
