import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TUTORIAL_SECTIONS } from '../../../data/tutorial';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import './TutorialModal.scss';

interface ITutorialModalProps {
  /** Closes the modal (cancel button, backdrop click, Escape). */
  onClose: () => void;
}

/**
 * New-player tutorial. Opened from the avatar menu ("Tutorial"). Renders via a
 * portal to document.body (like the other menu modals) so it survives the menu
 * closing. Data-driven from `TUTORIAL_SECTIONS` — each section is a numbered,
 * bold-titled card with a one-liner + bullet points.
 */
const TutorialModal = ({ onClose }: ITutorialModalProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="tutorial__backdrop" onClick={onClose} role="presentation">
      <div
        className="tutorial"
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial — jak grać"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tutorial__header">
          <h2 className="tutorial__title"><GameIcon name="open-book" /> Jak grać w Grimshade</h2>
          <button
            type="button"
            className="tutorial__close"
            onClick={onClose}
            aria-label="Zamknij tutorial"
          >
            <Icon name="x" />
          </button>
        </header>

        <p className="tutorial__lead">
          Krótki przewodnik po każdym ekranie gry. Przewiń w dół — każda sekcja
          mówi czym dany ekran jest i jak z niego korzystać.
        </p>

        <div className="tutorial__sections">
          {TUTORIAL_SECTIONS.map((section, idx) => (
            <section
              key={section.id}
              className="tutorial__section"
              data-section={section.id}
            >
              <h3 className="tutorial__section-title">
                <span className="tutorial__section-num">{idx + 1}.</span>
                <span className="tutorial__section-icon"><GameIcon name={section.icon} /></span>
                <strong>{section.title}</strong>
              </h3>
              <p className="tutorial__section-summary"><EmojiText>{section.summary}</EmojiText></p>
              <ul className="tutorial__section-list">
                {section.bullets.map((b, i) => (
                  <li key={i} className="tutorial__section-bullet"><EmojiText>{b}</EmojiText></li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="tutorial__footer">
          <button
            type="button"
            className="tutorial__done"
            onClick={onClose}
          >
            Rozumiem, zaczynam grać!
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default TutorialModal;
