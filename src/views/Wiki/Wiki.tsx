import { useEffect } from 'react';
import { WIKI_INTRO, WIKI_STARTER_TIPS, WIKI_SECTIONS } from '../../data/wiki';
import { APP_VERSION } from '../../lib/appVersion';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import logoUrl from '../../assets/images/pwa.png';
import './Wiki.scss';

const Wiki = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Grimshade — Wiki';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="wiki">
      <header className="wiki__topbar">
        <div className="wiki__brand">
          <img src={logoUrl} alt="Grimshade" className="wiki__logo" />
          <div className="wiki__brand-text">
            <span className="wiki__brand-name">Grimshade</span>
            <span className="wiki__brand-sub">Wiki &amp; Poradnik dla graczy</span>
          </div>
        </div>
        <a className="wiki__open-game" href="/" target="_blank" rel="noopener noreferrer">
          <GameIcon name="crossed-swords" />
          <span>Otwórz grę</span>
        </a>
      </header>

      <main className="wiki__body">
        <section className="wiki__hero">
          <h1 className="wiki__hero-title">{WIKI_INTRO.title}</h1>
          <p className="wiki__hero-lead"><EmojiText>{WIKI_INTRO.lead}</EmojiText></p>
        </section>

        <section className="wiki__tips" aria-label="Złote zasady dla początkujących">
          <h2 className="wiki__tips-title">
            <span className="wiki__tips-icon"><GameIcon name="glowing-star" /></span>
            Zanim ruszysz w bój — złote zasady
          </h2>
          <ol className="wiki__tips-list">
            {WIKI_STARTER_TIPS.map((tip, i) => (
              <li key={i} className={`wiki__tip${tip.strong ? ' wiki__tip--strong' : ''}`}>
                <span className="wiki__tip-icon"><GameIcon name={tip.icon} /></span>
                <span className="wiki__tip-text"><EmojiText>{tip.text}</EmojiText></span>
              </li>
            ))}
          </ol>
        </section>

        <nav className="wiki__toc" aria-label="Spis treści">
          <h2 className="wiki__toc-title">Spis treści</h2>
          <ul className="wiki__toc-list">
            {WIKI_SECTIONS.map((section, idx) => (
              <li key={section.id} className="wiki__toc-item">
                <a href={`#${section.id}`} className="wiki__toc-link">
                  <span className="wiki__toc-num">{idx + 1}</span>
                  <span className="wiki__toc-icon"><GameIcon name={section.icon} /></span>
                  <span className="wiki__toc-label">{section.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="wiki__sections">
          {WIKI_SECTIONS.map((section, idx) => (
            <section
              key={section.id}
              id={section.id}
              className="wiki__section"
              data-section={section.id}
            >
              <h2 className="wiki__section-title">
                <span className="wiki__section-num">{idx + 1}.</span>
                <span className="wiki__section-icon"><GameIcon name={section.icon} /></span>
                <span>{section.title}</span>
              </h2>
              <p className="wiki__section-summary"><EmojiText>{section.summary}</EmojiText></p>
              <ul className="wiki__section-list">
                {section.bullets.map((b, i) => (
                  <li key={i} className="wiki__section-bullet"><EmojiText>{b}</EmojiText></li>
                ))}
              </ul>
              {section.tables?.map((table, ti) => (
                <div key={ti} className="wiki__table-wrap">
                  {table.caption && <p className="wiki__table-caption">{table.caption}</p>}
                  <table className="wiki__table">
                    <thead>
                      <tr>
                        {table.headers.map((h, hi) => (
                          <th key={hi}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci}><EmojiText>{cell}</EmojiText></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {section.note && (
                <p className="wiki__section-note"><EmojiText>{section.note}</EmojiText></p>
              )}
            </section>
          ))}
        </div>

        <footer className="wiki__footer">
          <a className="wiki__footer-top" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <GameIcon name="up-arrow" /> Wróć na górę
          </a>
          <p className="wiki__footer-meta">
            Grimshade · Wiki aktualizowana wraz z grą · wersja gry v{APP_VERSION}
          </p>
        </footer>
      </main>
    </div>
  );
};

export default Wiki;
