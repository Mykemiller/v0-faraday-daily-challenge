'use client';

import { useState, useMemo, useCallback } from 'react';

// Types
type DifficultyColor = 'green' | 'yellow' | 'orange' | 'red';

interface GameGroup {
  id: string;
  title: string;
  connection: string;
  difficulty: DifficultyColor;
  terms: string[];
}

interface GameState {
  groups: GameGroup[];
  solvedGroups: GameGroup[];
  selectedTerms: string[];
  mistakes: number;
  gameOver: boolean;
  gameWon: boolean;
  shuffledTerms: string[];
}

interface AnimatingGroup {
  id: string;
  terms: string[];
}

// Constants
const PUZZLE_DATA: GameGroup[] = [
  {
    id: 'green',
    title: 'Power Distribution Equipment',
    connection: 'Power Distribution Equipment',
    difficulty: 'green',
    terms: ['BUSBAR', 'SWITCHGEAR', 'UPS', 'PDU'],
  },
  {
    id: 'yellow',
    title: 'Efficiency Metrics',
    connection: 'Efficiency Metrics',
    difficulty: 'yellow',
    terms: ['PUE', 'CUE', 'WUE', 'DCiE'],
  },
  {
    id: 'orange',
    title: 'Chip Manufacturers',
    connection: 'Chip Manufacturers',
    difficulty: 'orange',
    terms: ['NVIDIA', 'AMD', 'INTEL', 'QUALCOMM'],
  },
  {
    id: 'red',
    title: 'Grid & Regulatory Bodies',
    connection: 'Grid & Regulatory Bodies',
    difficulty: 'red',
    terms: ['FERC', 'NERC', 'ISO-NE', 'ERCOT'],
  },
];

const DIFFICULTY_COLORS: Record<DifficultyColor, string> = {
  green: 'bg-green-600',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red: 'bg-red-600',
};

const DIFFICULTY_COLORS_LIGHT: Record<DifficultyColor, string> = {
  green: 'bg-green-100',
  yellow: 'bg-yellow-100',
  orange: 'bg-orange-100',
  red: 'bg-red-100',
};

// Utility function to shuffle array
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Calculate score based on mistakes
function calculateScore(mistakes: number, won: boolean): number {
  if (!won) return 10;
  switch (mistakes) {
    case 0:
      return 100;
    case 1:
      return 80;
    case 2:
      return 60;
    case 3:
      return 40;
    default:
      return 10;
  }
}

export default function RacklPage() {
  const [gameState, setGameState] = useState<GameState>(() => ({
    groups: PUZZLE_DATA,
    solvedGroups: [],
    selectedTerms: [],
    mistakes: 0,
    gameOver: false,
    gameWon: false,
    shuffledTerms: shuffleArray(PUZZLE_DATA.flatMap((g) => g.terms)),
  }));

  const [animatingGroup, setAnimatingGroup] = useState<AnimatingGroup | null>(null);
  const [shakeAnimation, setShakeAnimation] = useState(false);

  // Check if a term is selected
  const isTermSelected = useCallback(
    (term: string) => gameState.selectedTerms.includes(term),
    [gameState.selectedTerms]
  );

  // Check if a term is already solved
  const isTermSolved = useCallback(
    (term: string) =>
      gameState.solvedGroups.some((group) => group.terms.includes(term)),
    [gameState.solvedGroups]
  );

  // Handle tile click
  const handleTileClick = useCallback(
    (term: string) => {
      if (gameState.gameOver || gameState.gameWon || isTermSolved(term)) {
        return;
      }

      const newSelected = isTermSelected(term)
        ? gameState.selectedTerms.filter((t) => t !== term)
        : [...gameState.selectedTerms, term].slice(-4);

      setGameState((prev) => ({
        ...prev,
        selectedTerms: newSelected,
      }));
    },
    [gameState.gameOver, gameState.gameWon, isTermSelected, isTermSolved]
  );

  // Submit selected group
  const handleSubmit = useCallback(() => {
    if (gameState.selectedTerms.length !== 4) return;

    const selectedSet = new Set(gameState.selectedTerms);
    const matchingGroup = gameState.groups.find(
      (group) =>
        !gameState.solvedGroups.some((solved) => solved.id === group.id) &&
        group.terms.every((term) => selectedSet.has(term)) &&
        group.terms.length === gameState.selectedTerms.length
    );

    if (matchingGroup) {
      // Correct group!
      setAnimatingGroup({
        id: matchingGroup.id,
        terms: gameState.selectedTerms,
      });

      setTimeout(() => {
        setGameState((prev) => {
          const newSolved = [...prev.solvedGroups, matchingGroup];
          const isWon = newSolved.length === 4;

          return {
            ...prev,
            solvedGroups: newSolved,
            selectedTerms: [],
            gameWon: isWon,
            gameOver: isWon,
          };
        });
        setAnimatingGroup(null);
      }, 600);
    } else {
      // Wrong group
      setShakeAnimation(true);
      const newMistakes = gameState.mistakes + 1;
      const isGameOver = newMistakes >= 4;

      setTimeout(() => {
        setShakeAnimation(false);
        setGameState((prev) => ({
          ...prev,
          selectedTerms: [],
          mistakes: newMistakes,
          gameOver: isGameOver,
        }));
      }, 600);
    }
  }, [gameState]);

  // Reset game
  const handleNewPuzzle = useCallback(() => {
    setGameState({
      groups: PUZZLE_DATA,
      solvedGroups: [],
      selectedTerms: [],
      mistakes: 0,
      gameOver: false,
      gameWon: false,
      shuffledTerms: shuffleArray(PUZZLE_DATA.flatMap((g) => g.terms)),
    });
    setAnimatingGroup(null);
    setShakeAnimation(false);
  }, []);

  // Get remaining terms to display
  const remainingTerms = useMemo(() => {
    const solvedTerms = new Set(
      gameState.solvedGroups.flatMap((group) => group.terms)
    );
    return gameState.shuffledTerms.filter(
      (term) => !solvedTerms.has(term)
    );
  }, [gameState.shuffledTerms, gameState.solvedGroups]);

  const score = useMemo(
    () => calculateScore(gameState.mistakes, gameState.gameWon),
    [gameState.mistakes, gameState.gameWon]
  );

  return (
    <div className="min-h-screen bg-warmWhite py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold mb-2 text-forest font-serif">
            🟦 Rackl
          </h1>
          <p className="text-lg text-sage">
            Find the four groups of four
          </p>
        </div>

        {/* Puzzle Title */}
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-semibold text-forest font-serif">
            Data Center Infrastructure Domains
          </h2>
        </div>

        {/* Solved Groups */}
        {gameState.solvedGroups.length > 0 && (
          <div className="mb-8 space-y-3">
            {gameState.solvedGroups.map((group) => (
              <div
                key={group.id}
                className={`${DIFFICULTY_COLORS[group.difficulty]} rounded-lg p-4 text-white shadow-md`}
              >
                <div className="font-semibold text-sm mb-1">
                  {group.connection}
                </div>
                <div className="text-xs opacity-90">
                  {group.terms.join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Game Stats */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-forest">Mistakes remaining:</span>
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    i < 4 - gameState.mistakes
                      ? 'bg-forest'
                      : 'bg-warmGray'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="text-sm font-semibold text-gold">
            {gameState.mistakes}/4
          </div>
        </div>

        {/* Game Grid or Game Over Screen */}
        {!gameState.gameOver ? (
          <>
            {/* Tile Grid */}
            <div
              className={`grid grid-cols-4 gap-3 mb-8 ${
                shakeAnimation ? 'animate-pulse' : ''
              }`}
              style={
                shakeAnimation
                  ? {
                      animation: 'shake 0.4s ease-in-out',
                    }
                  : undefined
              }
            >
              {remainingTerms.map((term) => (
                <button
                  key={term}
                  onClick={() => handleTileClick(term)}
                  disabled={gameState.gameOver || gameState.gameWon}
                  className={`
                    aspect-square rounded-lg font-semibold text-sm md:text-base
                    transition-all duration-300 transform
                    flex items-center justify-center text-center p-2
                    ${
                      animatingGroup?.terms.includes(term)
                        ? 'scale-0 opacity-0'
                        : 'scale-100 opacity-100'
                    }
                    ${
                      isTermSelected(term)
                        ? `border-4 border-gold bg-forest text-warmWhite shadow-lg`
                        : `bg-forest text-warmWhite hover:bg-forestLight cursor-pointer`
                    }
                    ${
                      isTermSolved(term)
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }
                    disabled:cursor-not-allowed
                  `}
                >
                  {term}
                </button>
              ))}
            </div>

            {/* Shake animation keyframes */}
            <style>{`
              @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-10px); }
                75% { transform: translateX(10px); }
              }
            `}</style>

            {/* Controls */}
            <div className="flex gap-4 justify-center flex-wrap">
              {gameState.selectedTerms.length === 4 && (
                <button
                  onClick={handleSubmit}
                  className="px-8 py-3 bg-gold text-forest font-semibold rounded-lg
                    hover:bg-goldLight transition-colors duration-200
                    shadow-md hover:shadow-lg"
                >
                  Submit
                </button>
              )}

              {gameState.selectedTerms.length > 0 && (
                <button
                  onClick={() =>
                    setGameState((prev) => ({
                      ...prev,
                      selectedTerms: [],
                    }))
                  }
                  className="px-8 py-3 border-2 border-forest text-forest font-semibold rounded-lg
                    hover:bg-forest hover:text-warmWhite transition-colors duration-200"
                >
                  Deselect All
                </button>
              )}

              <button
                onClick={handleNewPuzzle}
                className="px-8 py-3 border-2 border-forest text-forest font-semibold rounded-lg
                  hover:bg-forest hover:text-warmWhite transition-colors duration-200"
              >
                New Puzzle
              </button>
            </div>
          </>
        ) : (
          <div className="text-center">
            {gameState.gameWon ? (
              <div className="mb-8">
                <div className="text-6xl mb-6">🎉</div>
                <h3 className="text-4xl font-bold text-forest font-serif mb-4">
                  Congratulations!
                </h3>
                <p className="text-2xl font-semibold text-gold mb-8">
                  Score: {score}
                </p>
              </div>
            ) : (
              <div className="mb-8">
                <div className="text-6xl mb-6">😔</div>
                <h3 className="text-4xl font-bold text-forest font-serif mb-4">
                  Game Over
                </h3>
                <p className="text-2xl font-semibold text-forest mb-8">
                  Score: {score}
                </p>

                {/* Show all groups at game over */}
                <div className="mb-12 space-y-3 max-w-2xl mx-auto">
                  {gameState.groups.map((group) => (
                    <div
                      key={group.id}
                      className={`${DIFFICULTY_COLORS[group.difficulty]} rounded-lg p-4 text-white shadow-md`}
                    >
                      <div className="font-semibold text-sm mb-1">
                        {group.connection}
                      </div>
                      <div className="text-xs opacity-90">
                        {group.terms.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleNewPuzzle}
              className="px-8 py-3 bg-gold text-forest font-semibold rounded-lg
                hover:bg-goldLight transition-colors duration-200
                shadow-md hover:shadow-lg"
            >
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
