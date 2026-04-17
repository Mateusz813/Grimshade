import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import './ForgotPassword.scss';

const getForgotSchema = () =>
  z.object({
    email: z.string().email('Nieprawidłowy email'),
  });

type IForgotForm = z.infer<ReturnType<typeof getForgotSchema>>;

const ForgotPassword = () => {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IForgotForm>({ resolver: zodResolver(getForgotSchema()) });

  const onSubmit = async (data: IForgotForm) => {
    const { error } = await supabase.auth.resetPasswordForEmail(data.email);
    if (error) {
      setError('root', { message: error.message });
      return;
    }
    setSent(true);
  };

  return (
    <div className="forgot-password">
      <div className="forgot-password__card">
        <h1 className="forgot-password__title">Reset hasła</h1>
        {sent ? (
          <p className="forgot-password__success">
            Link resetujący został wysłany na podany adres email.
          </p>
        ) : (
          <form className="forgot-password__form" onSubmit={handleSubmit(onSubmit)}>
            <div className="forgot-password__field">
              <label className="forgot-password__label">Email</label>
              <input
                className="forgot-password__input"
                type="email"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <span className="forgot-password__error">{errors.email.message}</span>
              )}
            </div>
            {errors.root && (
              <span className="forgot-password__error">{errors.root.message}</span>
            )}
            <button className="forgot-password__button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Wysyłanie…' : 'Wyślij link'}
            </button>
          </form>
        )}
        <div className="forgot-password__links">
          <Link to="/login">Wróć do logowania</Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
