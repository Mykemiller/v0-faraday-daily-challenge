'use client';
import { useState } from 'react';
import { JpsTier, ConfidenceTier, JoISet, ScoreMode } from '@/lib/jurisdiction-watch/types';

interface FilterState {
  tiers:           JpsTier[];
  confidenceTiers: ConfidenceTier[];
  levels:          string[];
  activeJoISetId:  string | null;
  scoreMode:       ScoreMode;
  geoFilter:       string;
}

// JW design system colors — extracted from live product screenshots
const TIER_CONFIG: { tier: JpsTier; label: string; hex: string }[] = [
  { tier: 'Leading',    label: 'Leading',    hex: '#1C1C1C' },
  { tier: 'Favorable',  label: 'Favorable',  hex: '#8B6B1A' },
  { tier: 'Mixed',      label: 'Mixed',      hex: '#4A5C35' },
  { tier: 'Cautious',   label: 'Cautious',   hex: '#8B4A1A' },
  { tier: 'Restricted', label: 'Restricted', hex: '#6B2525' },
];

const CONFIDENCE_CONFIG: { tier: ConfidenceTier; label: string }[] = [
  { tier: 'verified',  label: 'Verified' },
  { tier: 'estimated', label: 'Estimated' },
  { tier: 'inferred',  label: 'Inferred' },
  { tier: 'unscored',  label: 'Unscored' },
];

const LEVELS = ['country', 'state', 'metro', 'county'];
const SCORE_MODES: { key: ScoreMode; label: string }[] = [
  { key: 'posture',    label: 'Posture' },
  { key: 'density',    label: 'Density' },
  { key: 'confidence', label: 'Confidence' },
];

export function FilterToolbar({
  joiSets,
  onChange,
}: {
  joiSets: JoISet[];
  onChange: (f: FilterState) => void;
}) {
  const [filters, setFilters] = useState<FilterState>({
    tiers:           ['Leading', 'Favorable', 'Mixed', 'Cautious', 'Restricted'],
    confidenceTiers: ['verified', 'estimated', 'inferred', 'unscored'],
    levels:          ['country', 'state', 'metro', 'county'],
    activeJoISetId:  null,
    scoreMode:       'posture',
    geoFilter:       '',
  });

  const update = (patch: Partial<FilterState>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange(next);
  };

  const toggleTier = (tier: JpsTier) => update({
    tiers: filters.tiers.includes(tier)
      ? filters.tiers.filter(t => t !== tier)
      : [...filters.tiers, tier],
  });

  const toggleLevel = (lvl: string) => update({
    levels: filters.levels.includes(lvl)
      ? filters.levels.filter(l => l !== lvl)
      : [...filters.levels, lvl],
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5
                    bg-white border-b border-stone-200 text-xs">

      {/* Score mode */}
      <div className="flex items-center gap-1">
        <span className="text-stone-400 font-medium uppercase tracking-widest mr-1">
          View
        </span>
        {SCORE_MODES.map(m => (
          <button key={m.key} onClick={() => update({ scoreMode: m.key })}
            className={`px-2.5 py-1 rounded transition-colors
              ${filters.scoreMode === m.key
                ? 'bg-stone-800 text-white'
                : 'text-stone-500 hover:text-stone-800'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Posture tier toggles — only shown in posture mode */}
      {filters.scoreMode === 'posture' && (
        <div className="flex items-center gap-1">
          <span className="text-stone-400 font-medium uppercase tracking-widest mr-1">
            Posture
          </span>
          {TIER_CONFIG.map(({ tier, label, hex }) => (
            <button key={tier} onClick={() => toggleTier(tier)}
              style={{
                backgroundColor: filters.tiers.includes(tier) ? hex : 'transparent',
                color:           filters.tiers.includes(tier) ? '#FFFFFF' : hex,
                borderColor:     hex,
              }}
              className="px-2.5 py-0.5 rounded-full border text-xs font-medium
                         transition-all duration-150">
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Confidence filter — only shown in confidence mode */}
      {filters.scoreMode === 'confidence' && (
        <div className="flex items-center gap-1">
          <span className="text-stone-400 font-medium uppercase tracking-widest mr-1">
            Confidence
          </span>
          {CONFIDENCE_CONFIG.map(({ tier, label }) => (
            <button key={tier}
              onClick={() => update({
                confidenceTiers: filters.confidenceTiers.includes(tier)
                  ? filters.confidenceTiers.filter(t => t !== tier)
                  : [...filters.confidenceTiers, tier],
              })}
              className={`px-2.5 py-0.5 rounded-full border text-xs font-medium transition-all
                ${filters.confidenceTiers.includes(tier)
                  ? 'bg-blue-900 border-blue-900 text-white'
                  : 'border-stone-300 text-stone-400'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Level filter */}
      <div className="flex items-center gap-1">
        <span className="text-stone-400 font-medium uppercase tracking-widest mr-1">
          Level
        </span>
        {LEVELS.map(lvl => (
          <button key={lvl} onClick={() => toggleLevel(lvl)}
            className={`px-2 py-0.5 rounded border text-xs capitalize transition-colors
              ${filters.levels.includes(lvl)
                ? 'bg-stone-800 border-stone-800 text-white'
                : 'border-stone-300 text-stone-400'}`}>
            {lvl}
          </button>
        ))}
      </div>

      {/* JoI set selector */}
      {joiSets.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-stone-400 font-medium uppercase tracking-widest mr-1">
            Watch List
          </span>
          <button onClick={() => update({ activeJoISetId: null })}
            className={`px-2 py-0.5 rounded border text-xs transition-colors
              ${!filters.activeJoISetId
                ? 'bg-stone-800 border-stone-800 text-white'
                : 'border-stone-300 text-stone-400'}`}>
            All
          </button>
          {joiSets.map(set => (
            <button key={set.id} onClick={() => update({ activeJoISetId: set.id })}
              style={filters.activeJoISetId === set.id
                ? { backgroundColor: set.color, borderColor: set.color, color: '#FFFFFF' }
                : { borderColor: set.color, color: set.color }}
              className="px-2 py-0.5 rounded border text-xs transition-all max-w-[120px] truncate">
              {set.name}
            </button>
          ))}
        </div>
      )}

      {/* Geo search */}
      <input value={filters.geoFilter}
        onChange={e => update({ geoFilter: e.target.value })}
        placeholder="Search jurisdiction..."
        className="ml-auto px-3 py-1 border border-stone-200 rounded text-xs w-44
                   focus:outline-none focus:border-stone-400" />
    </div>
  );
}
