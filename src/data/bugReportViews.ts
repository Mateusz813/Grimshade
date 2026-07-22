export interface IBugReportView {
  key: string;
  label: string;
}

export const BUG_REPORT_OTHER_KEY = 'other';

export const BUG_REPORT_VIEWS: IBugReportView[] = [
  { key: 'town', label: 'Miasto' },
  { key: 'battle', label: 'Walka' },
  { key: 'combat', label: 'Polowanie' },
  { key: 'dungeon', label: 'Loch' },
  { key: 'boss', label: 'Boss' },
  { key: 'raid', label: 'Rajd' },
  { key: 'arena', label: 'Arena' },
  { key: 'transform', label: 'Transformacje' },
  { key: 'trainer', label: 'Trener' },
  { key: 'offline-hunt', label: 'Polowanie offline' },
  { key: 'inventory', label: 'Postać i ekwipunek' },
  { key: 'deposit', label: 'Depozyt' },
  { key: 'shop', label: 'Sklep' },
  { key: 'market', label: 'Targ' },
  { key: 'quests', label: 'Questy' },
  { key: 'tasks', label: 'Taski' },
  { key: 'monsters', label: 'Bestiariusz' },
  { key: 'leaderboard', label: 'Ranking' },
  { key: 'deaths', label: 'Śmierci' },
  { key: 'guild', label: 'Gildia' },
  { key: 'party', label: 'Drużyna' },
  { key: 'chat', label: 'Czat' },
  { key: 'friends', label: 'Znajomi' },
  { key: 'social', label: 'Społeczność' },
  { key: 'wiki', label: 'Wiki' },
  { key: 'character-select', label: 'Wybór postaci' },
  { key: 'create-character', label: 'Tworzenie postaci' },
  { key: 'auth', label: 'Logowanie / rejestracja' },
  { key: 'menu', label: 'Menu i ustawienia' },
  { key: BUG_REPORT_OTHER_KEY, label: 'Inne' },
];
