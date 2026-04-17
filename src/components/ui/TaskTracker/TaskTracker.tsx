import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTaskStore } from '../../../stores/taskStore';
import { useCharacterStore } from '../../../stores/characterStore';
import type { IActiveTask } from '../../../stores/taskStore';
import './TaskTracker.scss';

const HIDDEN_PATHS = ['/login', '/register', '/forgot-password', '/character-select', '/create-character', '/tasks'];

interface ITaskTrackerItemProps {
    task: IActiveTask;
    index: number;
    onClick: () => void;
}

const TaskTrackerItem = ({ task, index, onClick }: ITaskTrackerItemProps) => {
    const [animating, setAnimating] = useState(false);
    const prevProgress = useRef(task.progress);

    useEffect(() => {
        if (task.progress > prevProgress.current) {
            setAnimating(true);
            const timer = setTimeout(() => setAnimating(false), 600);
            prevProgress.current = task.progress;
            return () => clearTimeout(timer);
        }
        prevProgress.current = task.progress;
    }, [task.progress]);

    const pct = Math.min(100, Math.floor((task.progress / task.killCount) * 100));
    const isDone = task.progress >= task.killCount;

    return (
        <div
            className={`task-tracker__item${isDone ? ' task-tracker__item--done' : ''}${animating ? ' task-tracker__item--bump' : ''}`}
            onClick={onClick}
            title={`Task: ${task.monsterName}`}
            style={{ top: `${10 + index * 48}px` }}
        >
            <span className="task-tracker__icon">{isDone ? '\u2705' : '\uD83D\uDCCB'}</span>
            <div className="task-tracker__info">
                <span className="task-tracker__name">{task.monsterName}</span>
                <div className="task-tracker__counter">
                    <span className={`task-tracker__number${animating ? ' task-tracker__number--pop' : ''}`}>
                        {task.progress}
                    </span>
                    <span className="task-tracker__separator">/</span>
                    <span className="task-tracker__total">{task.killCount}</span>
                </div>
            </div>
            <div className="task-tracker__bar">
                <div
                    className={`task-tracker__bar-fill${isDone ? ' task-tracker__bar-fill--done' : ''}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {animating && <span className="task-tracker__kill-flash">+1</span>}
        </div>
    );
};

const TaskTracker = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const activeTasks = useTaskStore((s) => s.activeTasks);

    if (!character || activeTasks.length === 0 || HIDDEN_PATHS.includes(location.pathname)) {
        return null;
    }

    return (
        <div className="task-tracker">
            {activeTasks.map((task, idx) => (
                <TaskTrackerItem
                    key={task.id}
                    task={task}
                    index={idx}
                    onClick={() => navigate('/tasks')}
                />
            ))}
        </div>
    );
};

export default TaskTracker;
