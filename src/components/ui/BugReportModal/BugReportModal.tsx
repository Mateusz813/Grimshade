import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { bugReportsApi, BUG_REPORT_CONTENT_MAX } from '../../../api/v1/bugReportsApi';
import { useCharacterStore } from '../../../stores/characterStore';
import { BUG_REPORT_VIEWS } from '../../../data/bugReportViews';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './BugReportModal.scss';

interface IBugReportModalProps {
  onClose: () => void;
}

const BugReportModal = ({ onClose }: IBugReportModalProps) => {
  const character = useCharacterStore((s) => s.character);

  const [viewKey, setViewKey] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = viewKey !== '' && content.trim() !== '' && !sending;

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 2200);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const saved = await bugReportsApi.submitReport({
        view_key: viewKey,
        content,
        character_id: character?.id ?? null,
        character_name: character?.name ?? null,
      });
      if (!saved) {
        setError('Nie udało się zapisać zgłoszenia. Spróbuj ponownie.');
        return;
      }
      setDone(true);
    } catch {
      setError('Nie udało się zapisać zgłoszenia. Spróbuj ponownie.');
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="bug-report__backdrop" onClick={onClose} role="presentation">
      <div
        className="bug-report"
        role="dialog"
        aria-modal="true"
        aria-label="Zgłoś błąd"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="bug-report__toast" role="status">
            <span className="bug-report__toast-icon"><GameIcon name="check-mark-button" /></span>
            <span>Dziękujemy! Zgłoszenie zapisane</span>
          </div>
        ) : (
          <>
            <h2 className="bug-report__title">Zgłoś błąd</h2>
            <form className="bug-report__form" onSubmit={(e) => void handleSubmit(e)} noValidate>
              <label className="bug-report__label" htmlFor="bug-report-view">
                Gdzie wystąpił błąd?
              </label>
              <select
                id="bug-report-view"
                className="bug-report__select"
                value={viewKey}
                onChange={(e) => setViewKey(e.target.value)}
              >
                <option value="" disabled>Wybierz widok…</option>
                {BUG_REPORT_VIEWS.map((v) => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </select>

              <label className="bug-report__label" htmlFor="bug-report-content">
                Opis błędu
              </label>
              <textarea
                id="bug-report-content"
                className="bug-report__textarea"
                rows={6}
                maxLength={BUG_REPORT_CONTENT_MAX}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Co się stało? Co robiłeś przed błędem?"
              />
              <span className="bug-report__counter">
                {content.length} / {BUG_REPORT_CONTENT_MAX}
              </span>

              {error && <p className="bug-report__error">{error}</p>}

              <div className="bug-report__actions">
                <button
                  type="button"
                  className="bug-report__btn bug-report__btn--ghost"
                  onClick={onClose}
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="bug-report__btn bug-report__btn--primary"
                  disabled={!canSubmit}
                >
                  {sending ? 'Wysyłam…' : 'Wyślij'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default BugReportModal;
