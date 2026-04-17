import { AnimatePresence, motion } from 'framer-motion';
import './OfflineRewardModal.scss';

interface IOfflineRewardModalProps {
  show: boolean;
  skillName: string;
  earnedXp: number;
  timeElapsed: number; // seconds
  onClose: () => void;
}

const formatTime = (secs: number): string => {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
};

const OfflineRewardModal = ({
  show,
  skillName,
  earnedXp,
  timeElapsed,
  onClose,
}: IOfflineRewardModalProps) => (
  <AnimatePresence>
    {show && (
      <>
        <motion.div
          className="offline-reward-modal__overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="offline-reward-modal"
          initial={{ opacity: 0, scale: 0.9, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <div className="offline-reward-modal__icon">🎓</div>
          <h2 className="offline-reward-modal__title">Trening offline!</h2>
          <p className="offline-reward-modal__text">
            Byłeś offline przez <strong>{formatTime(timeElapsed)}</strong>.
          </p>
          <p className="offline-reward-modal__text">
            Skill <strong>{skillName}</strong> zebrał{' '}
            <span className="offline-reward-modal__xp">+{earnedXp} XP</span>!
          </p>
          <button className="offline-reward-modal__btn" onClick={onClose}>
            Odbierz
          </button>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default OfflineRewardModal;
