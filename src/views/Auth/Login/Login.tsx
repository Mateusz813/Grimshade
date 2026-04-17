import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import './Login.scss';

const getLoginSchema = () =>
  z.object({
    email: z.string().email('Nieprawidłowy email'),
    password: z.string().min(6, 'Min. 6 znaków'),
  });

type ILoginForm = z.infer<ReturnType<typeof getLoginSchema>>;

const Login = () => {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ILoginForm>({ resolver: zodResolver(getLoginSchema()) });

  const onSubmit = async (data: ILoginForm) => {
    const { error } = await supabase.auth.signInWithPassword({
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
    <div className="login">
      <div className="login__card">
        <h1 className="login__title">⚔️ Grimshade</h1>
        <form className="login__form" onSubmit={handleSubmit(onSubmit)}>
          <div className="login__field">
            <label className="login__label">Email</label>
            <input
              className="login__input"
              type="email"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <span className="login__error">{errors.email.message}</span>}
          </div>
          <div className="login__field">
            <label className="login__label">Hasło</label>
            <input
              className="login__input"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && <span className="login__error">{errors.password.message}</span>}
          </div>
          {errors.root && <span className="login__error">{errors.root.message}</span>}
          <button className="login__button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Logowanie…' : 'Zaloguj się'}
          </button>
        </form>
        <div className="login__links">
          <Link to="/register">Zarejestruj się</Link>
          <Link to="/forgot-password">Zapomniałem hasła</Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
