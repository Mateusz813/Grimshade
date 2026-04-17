import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import './Register.scss';

const getRegisterSchema = () =>
  z
    .object({
      email: z.string().email('Nieprawidłowy email'),
      password: z.string().min(6, 'Min. 6 znaków'),
      confirmPassword: z.string().min(6, 'Min. 6 znaków'),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'Hasła muszą być takie same',
      path: ['confirmPassword'],
    });

type IRegisterForm = z.infer<ReturnType<typeof getRegisterSchema>>;

const Register = () => {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IRegisterForm>({ resolver: zodResolver(getRegisterSchema()) });

  const onSubmit = async (data: IRegisterForm) => {
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
    });
    if (error) {
      setError('root', { message: error.message });
      return;
    }
    navigate('/');
  };

  return (
    <div className="register">
      <div className="register__card">
        <h1 className="register__title">Rejestracja</h1>
        <form className="register__form" onSubmit={handleSubmit(onSubmit)}>
          <div className="register__field">
            <label className="register__label">Email</label>
            <input
              className="register__input"
              type="email"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <span className="register__error">{errors.email.message}</span>}
          </div>
          <div className="register__field">
            <label className="register__label">Hasło</label>
            <input
              className="register__input"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && <span className="register__error">{errors.password.message}</span>}
          </div>
          <div className="register__field">
            <label className="register__label">Potwierdź hasło</label>
            <input
              className="register__input"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <span className="register__error">{errors.confirmPassword.message}</span>
            )}
          </div>
          {errors.root && <span className="register__error">{errors.root.message}</span>}
          <button className="register__button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Rejestracja…' : 'Zarejestruj się'}
          </button>
        </form>
        <div className="register__links">
          <Link to="/login">Masz już konto? Zaloguj się</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
