'use client';
import { useState, useEffect } from 'react';
import { SESSION_STORAGE_KEY } from '@/lib/supabase';
import { JoISet } from '@/lib/jurisdiction-watch/types';

// JW tier colors — used as set color swatches
const SWATCH_COLORS = [
  { hex: '#1C1C1C', label: 'Leading' },
  { hex: '#8B6B1A', label: 'Favorable' },
  { hex: '#4A5C35', label: 'Mixed' },
  { hex: '#8B4A1A', label: 'Cautious' },
  { hex: '#6B2525', label: 'Restricted' },
  { hex: '#2B4C7E', label: 'Custom' },
];

function getToken(): string | null {
  try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}

export function JoIManager() {
  const [sets, setSets]           = useState<JoISet[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState('');
  const [newDesc,    setNewDesc]    = useState('');
  const [newColor,   setNewColor]   = useState('#1C1C1C');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch(`/api/joi?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(setSets)
      .catch(() => {});
  }, []);

  const createSet = async () => {
    if (!newName.trim()) return;
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/joi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: newName, description: newDesc || undefined, color: newColor }),
    });
    if (res.ok) {
      const set = await res.json();
      setSets(prev => [...prev, set]);
      setNewName(''); setNewDesc(''); setNewColor('#1C1C1C'); setShowCreate(false);
    }
  };

  return (
    <div className="p-4 border border-stone-200 rounded-lg bg-stone-50">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-500">
          Jurisdictions of Interest ({sets.length}/10)
        </h2>
        {sets.length < 10 && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1 text-xs bg-stone-800 text-white rounded hover:bg-stone-700 transition-colors">
            + New Set
          </button>
        )}
      </div>

      {showCreate && (
        <div className="mb-4 p-3 bg-white rounded border border-stone-200">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Set name (e.g. Southeast Targets)"
            className="w-full mb-2 px-3 py-1.5 border border-stone-200 rounded text-sm"
            maxLength={100} />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full mb-3 px-3 py-1.5 border border-stone-200 rounded text-sm" />
          <div className="flex gap-1.5 mb-3">
            {SWATCH_COLORS.map(s => (
              <button key={s.hex} onClick={() => setNewColor(s.hex)}
                title={s.label}
                style={{ backgroundColor: s.hex }}
                className={`w-5 h-5 rounded transition-transform
                  ${newColor === s.hex ? 'ring-2 ring-offset-1 ring-stone-400 scale-110' : ''}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={createSet}
              className="px-3 py-1 bg-stone-800 text-white rounded text-sm hover:bg-stone-700">
              Create
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-3 py-1 bg-stone-100 text-stone-600 rounded text-sm hover:bg-stone-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {sets.map(set => (
          <div key={set.id}
            className="flex items-center gap-3 p-2.5 border border-stone-200 rounded bg-white hover:border-stone-300 transition-colors">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                 style={{ backgroundColor: set.color }} />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm text-stone-800 truncate block">
                {set.name}
              </span>
              {set.description && (
                <p className="text-xs text-stone-400 truncate">{set.description}</p>
              )}
            </div>
            <span className="text-xs text-stone-400 flex-shrink-0">
              {set.memberCount ?? 0} jurisdictions
            </span>
            <button className="text-xs text-stone-400 hover:text-stone-700 flex-shrink-0">
              Manage →
            </button>
          </div>
        ))}
        {sets.length === 0 && (
          <p className="text-sm text-stone-400 py-6 text-center">
            No sets yet. Create your first Jurisdiction of Interest set.
          </p>
        )}
      </div>
    </div>
  );
}
