import { useState, useEffect, useRef } from 'react';
import type { ICombatActiveQuest } from './types';
import GameIcon from '../../atoms/Twemoji/GameIcon';

interface IProps {
    items: ICombatActiveQuest[];
}

const CombatTaskBadge = ({ items }: IProps) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (items.length === 0) return null;

    return (
        <div className="combat-ui__task-badge" ref={ref}>
            <button
                type="button"
                className="combat-ui__task-badge-btn"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label={`Zadania na tym potworze (${items.length})`}
            >
                <GameIcon name="scroll" />
                <span className="combat-ui__task-badge-count">{items.length}</span>
            </button>
            {open && (
                <div className="combat-ui__task-badge-dropdown" role="menu">
                    {items.map((q) => (
                        <div key={q.id} className={`combat-ui__task-row${q.completed ? ' combat-ui__task-row--done' : ''}`}>
                            <span className="combat-ui__task-row-icon">
                                {q.completed ? <GameIcon name="check-mark-button" /> : q.kind === 'task' ? <GameIcon name="clipboard" /> : <GameIcon name="scroll" />}
                            </span>
                            <span className="combat-ui__task-row-label">{q.label}</span>
                            <span className="combat-ui__task-row-progress">
                                {Math.min(q.progress, q.goal)}/{q.goal}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CombatTaskBadge;
