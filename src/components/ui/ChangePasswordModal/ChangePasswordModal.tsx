import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '../../../api/v1/authApi';
import './ChangePasswordModal.scss';

interface IChangePasswordModalProps {
  /** Closes the modal (called on cancel, backdrop click, Escape, and ~2.2s
   *  after a successful change so the toast reads as a confirmation). */
  onClose: () => void;
}

// Current password (security gate) + new password + confirmation. New
// password mirrors the Register contract (min 6, must match).
const getChangePasswordSchema = () =>
  z
    .object({
      currentPassword: z.string().min(1, 'Podaj obecne hasło'),
      password: z.string().min(6, 'Min. 6 znaków'),
      confirmPassword: z.string().min(6, 'Min. 6 znaków'),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'Hasła muszą być takie same',
      path: ['confirmPassword'],
    });

type IChangePasswordForm = z.infer<ReturnType<typeof getChangePasswordSchema>>;

/**
 * Password-change popup opened from the avatar menu. Renders via a portal to
 * document.body (like AdminPanel) so it survives the dropdown closing. On
 * success it swaps the form for a success toast and auto-closes.
 *
 * Supabase changes the password of the CURRENT session (authApi.updatePassword
 * → supabase.auth.updateUser) — no current password is required, just a live
 * session.
 */
const ChangePasswordModal = ({ onClose }: IChangePasswordModalProps) => {
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IChangePasswordForm>({
    resolver: zodResolver(getChangePasswordSchema()),
  });

  // Auto-close shortly after success so the toast reads as a transient
  // confirmation rather than a screen the user has to dismiss.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 2200);
    return () => window.clearTimeout(t);
  }, [done, onClose]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSubmit = async (data: IChangePasswordForm) => {
    try {
      // Security gate — confirm the current password before changing it.
      const ok = await authApi.verifyCurrentPassword(data.currentPassword);
      if (!ok) {
        setError('currentPassword', { message: 'Nieprawidłowe obecne hasło' });
        return;
      }
      await authApi.updatePassword(data.password);
      setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zmienić hasła';
      setError('root', { message: msg });
    }
  };

  return createPortal(
    <div
      className="change-password__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="change-password"
        role="dialog"
        aria-modal="true"
        aria-label="Zmiana hasła"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="change-password__toast" role="status">
            <span className="change-password__toast-icon">✅</span>
            <span>Hasło zmienione pomyślnie</span>
          </div>
        ) : (
          <>
            <h2 className="change-password__title">Zmiana hasła</h2>
            <form
              className="change-password__form"
              onSubmit={handleSubmit(onSubmit)}
              noValidate
            >
              <label className="change-password__label">
                Obecne hasło
                <input
                  type="password"
                  autoComplete="current-password"
                  className="change-password__input"
                  {...register('currentPassword')}
                />
              </label>
              {errors.currentPassword && (
                <p className="change-password__error">{errors.currentPassword.message}</p>
              )}

              <label className="change-password__label">
                Nowe hasło
                <input
                  type="password"
                  autoComplete="new-password"
                  className="change-password__input"
                  {...register('password')}
                />
              </label>
              {errors.password && (
                <p className="change-password__error">{errors.password.message}</p>
              )}

              <label className="change-password__label">
                Powtórz nowe hasło
                <input
                  type="password"
                  autoComplete="new-password"
                  className="change-password__input"
                  {...register('confirmPassword')}
                />
              </label>
              {errors.confirmPassword && (
                <p className="change-password__error">{errors.confirmPassword.message}</p>
              )}

              {errors.root && (
                <p className="change-password__error change-password__error--root">
                  {errors.root.message}
                </p>
              )}

              <div className="change-password__actions">
                <button
                  type="button"
                  className="change-password__btn change-password__btn--ghost"
                  onClick={onClose}
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="change-password__btn change-password__btn--primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Zapisuję…' : 'Zmień hasło'}
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

export default ChangePasswordModal;
